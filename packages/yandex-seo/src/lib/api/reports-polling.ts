import { resolveAccount } from "../account-resolver.js";
import { getAccessToken } from "../oauth/token-broker.js";
import { getApiSpec } from "./endpoints-spec.js";

export interface ReportPollingOpts {
  accountLabel?: string;
  clientLogin?: string;  // Client-Login header — agency sub-client login (e.g. "agency-client-login")
  body: Record<string, unknown>;  // Direct Reports request body
  maxWaitMs?: number;  // default 60_000
  processingMode?: "auto" | "online" | "offline";  // default "auto"
  retryDelaysMs?: number[];  // backoff for transient failures; default 2s → 4s → 8s → 16s
}

export interface ReportPollingResult {
  ok: boolean;
  status: number;
  tsv?: string;  // TSV string if 200
  rows?: Array<Record<string, string>>;  // parsed rows
  error?: unknown;  // parsed Direct error body (JSON) or raw text
  error_code?: number;  // Direct error_code, when the body carries one
  attempts: number;
  total_wait_ms: number;
}

/** Parse Direct's TSV response, skipping the optional report-title line. */
export function parseReportTsv(tsv: string): Array<Record<string, string>> {
  const lines = tsv.split(/\r?\n/).filter((line) => line.trim());
  let headerIndex = 0;
  while (headerIndex < lines.length && !lines[headerIndex]!.includes("\t")) {
    headerIndex++;
  }
  if (lines.length - headerIndex < 2) return [];

  const columns = lines[headerIndex]!.split("\t");
  return lines.slice(headerIndex + 1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
  });
}

/** HTTP statuses worth retrying: gateway hiccups on Direct's side. */
const TRANSIENT_HTTP = new Set([500, 502, 503, 504]);
/**
 * Direct error codes that clear up on their own: 52 — authorization server
 * temporarily unavailable, 1000 — service temporarily unavailable,
 * 9000 — too many reports queued for offline building.
 */
const TRANSIENT_DIRECT_CODES = new Set([52, 1000, 9000]);
const DEFAULT_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000];

/** Parse Direct's JSON error body; fall back to the raw text. */
export function parseReportError(text: string): { error: unknown; error_code?: number } {
  try {
    const parsed = JSON.parse(text) as { error?: { error_code?: unknown } };
    const code = Number(parsed?.error?.error_code);
    return Number.isFinite(code) ? { error: parsed, error_code: code } : { error: parsed };
  } catch {
    return { error: text };
  }
}

export function isTransientReportFailure(status: number, errorCode?: number): boolean {
  return TRANSIENT_HTTP.has(status) || (errorCode !== undefined && TRANSIENT_DIRECT_CODES.has(errorCode));
}

/** Direct's retryIn header is in seconds; ignore missing or garbage values. */
function retryInMs(response: Response): number | undefined {
  const seconds = parseInt(response.headers.get("retryIn") ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pollReport(opts: ReportPollingOpts): Promise<ReportPollingResult> {
  const spec = getApiSpec("direct");
  const acc = resolveAccount(spec.requiredScope, opts.accountLabel);
  const token = await getAccessToken(acc.id);
  const url = spec.baseUrl + "/json/v5/reports";
  const maxWait = opts.maxWaitMs ?? 60_000;
  const mode = opts.processingMode ?? "auto";
  const retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  const start = Date.now();
  let attempts = 0;
  let transientRetries = 0;
  // Last transient failure, reported instead of a bare "timeout" if the budget runs out.
  let lastFailure: Omit<ReportPollingResult, "attempts" | "total_wait_ms"> | undefined;

  /** Wait before the next transient retry; false when retries or the time budget are spent. */
  const backoff = async (hintMs?: number): Promise<boolean> => {
    if (transientRetries >= retryDelays.length) return false;
    const delay = Math.min(hintMs ?? retryDelays[transientRetries]!, 30_000);
    transientRetries++;
    if (Date.now() - start + delay >= maxWait) return false;
    await sleep(delay);
    return true;
  };

  while (Date.now() - start < maxWait) {
    attempts++;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "Accept-Language": "ru",
      "processingMode": mode,
      "skipReportSummary": "true",
      "skipReportHeader": "false",
    };
    // Agency/sub-client reports (e.g. agency-client-login) require the Client-Login header.
    if (opts.clientLogin) {
      headers["Client-Login"] = opts.clientLogin;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(opts.body),
      });
    } catch (e) {
      // Network-level failure (reset, DNS, TLS) — treat like a 5xx.
      lastFailure = { ok: false, status: 0, error: `network error: ${e instanceof Error ? e.message : String(e)}` };
      if (await backoff()) continue;
      break;
    }

    if (response.status === 200) {
      const tsv = await response.text();
      const rows = parseReportTsv(tsv);
      return { ok: true, status: 200, tsv, rows, attempts, total_wait_ms: Date.now() - start };
    }
    if (response.status === 201 || response.status === 202) {
      await sleep(Math.min(retryInMs(response) ?? 5000, 5000));
      continue;
    }
    const { error, error_code } = parseReportError(await response.text());
    lastFailure = { ok: false, status: response.status, error, error_code };
    if (isTransientReportFailure(response.status, error_code) && (await backoff(retryInMs(response)))) {
      continue;
    }
    return { ...lastFailure, attempts, total_wait_ms: Date.now() - start };
  }
  if (lastFailure) return { ...lastFailure, attempts, total_wait_ms: Date.now() - start };
  return { ok: false, status: 0, error: "timeout", attempts, total_wait_ms: Date.now() - start };
}
