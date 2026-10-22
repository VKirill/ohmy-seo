import { resolveAccount } from "../account-resolver.js";
import { getAccessToken } from "../oauth/token-broker.js";
import { getApiSpec } from "./endpoints-spec.js";
import { blockedDirectBody, getDirectAccessBlock, recordDirectResult } from "./direct-access.js";

export interface ReportPollingOpts {
  accountLabel?: string;
  clientLogin?: string;  // Client-Login header — agency sub-client login (e.g. "agency-client-login")
  body: Record<string, unknown>;  // Direct Reports request body
  maxWaitMs?: number;  // default 90_000 — below the hosted gateway's 120 s tool-call timeout
  processingMode?: "auto" | "online" | "offline";  // default "auto"
  retryDelaysMs?: number[];  // backoff for transient failures; default 2s → 4s → 8s → 16s
  pollIntervalMs?: number;  // minimum gap between requests for one report; default 10_000 (Direct's limit)
  forceRecheck?: boolean;  // call Direct even if this login was recently denied API access
}

export interface ReportPollingResult {
  ok: boolean;
  status: number;
  tsv?: string;  // TSV string if 200
  rows?: Array<Record<string, string>>;  // parsed rows
  error?: unknown;  // parsed Direct error body (JSON) or raw text
  error_code?: number;  // Direct error_code, when the body carries one
  pending?: boolean;  // report still building when the time budget ran out — repeat with the same report_name
  report_name?: string;  // ReportName sent to Direct; reuse it to fetch the same report
  retry_after_ms?: number;  // when pending: how long to wait before repeating the call
  skipped?: boolean;  // not sent: Direct recently denied API access for this login
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
/**
 * Direct lets one report be requested at most once per 10 s; polling sooner
 * returns error 56 «Данный метод можно запрашивать не чаще чем 1 раз в 10 секунд».
 * 56 means "too early", not failure: wait and request the same ReportName again.
 */
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const TOO_EARLY_DIRECT_CODE = 56;

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

/** error_string/error_detail from a parsed Direct error body, for the access-block record. */
function directErrorText(error: unknown): { error_string?: string; error_detail?: string } {
  const e = (error as { error?: { error_string?: unknown; error_detail?: unknown } } | undefined)?.error;
  return {
    error_string: e?.error_string === undefined ? undefined : String(e.error_string),
    error_detail: e?.error_detail === undefined ? undefined : String(e.error_detail),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pollReport(opts: ReportPollingOpts): Promise<ReportPollingResult> {
  const spec = getApiSpec("direct");
  const acc = resolveAccount(spec.requiredScope, opts.accountLabel);
  if (!opts.forceRecheck) {
    const block = getDirectAccessBlock(acc.id, opts.clientLogin);
    if (block) {
      const body = blockedDirectBody(block);
      return { ok: false, status: 403, error: body, error_code: block.error_code, skipped: true, attempts: 0, total_wait_ms: 0 };
    }
  }
  const token = await getAccessToken(acc.id);
  const url = spec.baseUrl + "/json/v5/reports";
  const maxWait = opts.maxWaitMs ?? 90_000;
  const mode = opts.processingMode ?? "auto";
  const retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const pollInterval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const params = (opts.body as { params?: { ReportName?: unknown } }).params;
  const reportName = typeof params?.ReportName === "string" ? params.ReportName : undefined;

  const start = Date.now();
  const elapsed = () => Date.now() - start;
  let attempts = 0;
  let transientRetries = 0;
  // Once Direct has accepted the report (201/202/56), every request counts against its 10 s limit.
  let queued = false;
  // Last transient failure, reported instead of a bare "timeout" if the budget runs out.
  let lastFailure: Omit<ReportPollingResult, "attempts" | "total_wait_ms"> | undefined;

  /** Wait before the next transient retry; false when retries or the time budget are spent. */
  const backoff = async (hintMs?: number): Promise<boolean> => {
    if (transientRetries >= retryDelays.length) return false;
    let delay = Math.min(hintMs ?? retryDelays[transientRetries]!, 30_000);
    if (queued) delay = Math.max(delay, pollInterval);
    transientRetries++;
    if (elapsed() + delay >= maxWait) return false;
    await sleep(delay);
    return true;
  };

  while (elapsed() < maxWait) {
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
      recordDirectResult(acc.id, opts.clientLogin, undefined);
      return { ok: true, status: 200, tsv, rows, report_name: reportName, attempts, total_wait_ms: elapsed() };
    }

    let failure: { error: unknown; error_code?: number } | undefined;
    if (response.status !== 201 && response.status !== 202) {
      failure = parseReportError(await response.text());
      if (failure.error_code !== undefined) {
        recordDirectResult(acc.id, opts.clientLogin, { error_code: failure.error_code, ...directErrorText(failure.error) });
      }
    }
    if (!failure || failure.error_code === TOO_EARLY_DIRECT_CODE) {
      // Still building (201/202) or polled too early (56): wait retryIn, never under the 10 s limit.
      queued = true;
      const wait = Math.max(retryInMs(response) ?? 0, pollInterval);
      if (elapsed() + wait >= maxWait) {
        return {
          ok: false,
          pending: true,
          status: response.status,
          ...(failure ?? {}),
          report_name: reportName,
          retry_after_ms: wait,
          attempts,
          total_wait_ms: elapsed(),
        };
      }
      await sleep(wait);
      continue;
    }

    lastFailure = { ok: false, status: response.status, ...failure };
    if (isTransientReportFailure(response.status, failure.error_code) && (await backoff(retryInMs(response)))) {
      continue;
    }
    return { ...lastFailure, attempts, total_wait_ms: elapsed() };
  }
  if (lastFailure) return { ...lastFailure, attempts, total_wait_ms: elapsed() };
  return { ok: false, status: 0, error: "timeout", attempts, total_wait_ms: elapsed() };
}
