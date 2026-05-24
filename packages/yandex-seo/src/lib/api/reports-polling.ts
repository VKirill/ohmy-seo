import { resolveAccount } from "../account-resolver.js";
import { getAccessToken } from "../oauth/token-broker.js";
import { getApiSpec } from "./endpoints-spec.js";

export interface ReportPollingOpts {
  accountLabel?: string;
  body: Record<string, unknown>;  // Direct Reports request body
  maxWaitMs?: number;  // default 60_000
  processingMode?: "auto" | "online" | "offline";  // default "auto"
}

export interface ReportPollingResult {
  ok: boolean;
  status: number;
  tsv?: string;  // TSV string if 200
  rows?: Array<Record<string, string>>;  // parsed rows
  error?: unknown;
  attempts: number;
  total_wait_ms: number;
}

export async function pollReport(opts: ReportPollingOpts): Promise<ReportPollingResult> {
  const spec = getApiSpec("direct");
  const acc = resolveAccount(spec.requiredScope, opts.accountLabel);
  const token = await getAccessToken(acc.id);
  const url = spec.baseUrl + "/json/v5/reports";
  const maxWait = opts.maxWaitMs ?? 60_000;
  const mode = opts.processingMode ?? "auto";

  const start = Date.now();
  let attempts = 0;

  while (Date.now() - start < maxWait) {
    attempts++;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
        "Accept-Language": "ru",
        "processingMode": mode,
        "skipReportSummary": "true",
        "skipReportHeader": "false",
      },
      body: JSON.stringify(opts.body),
    });

    if (response.status === 200) {
      const tsv = await response.text();
      const lines = tsv.split("\n").filter(l => l.trim());
      if (lines.length < 2) return { ok: true, status: 200, tsv, rows: [], attempts, total_wait_ms: Date.now() - start };
      const headers = lines[0].split("\t");
      const rows = lines.slice(1).map(line => {
        const values = line.split("\t");
        return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
      });
      return { ok: true, status: 200, tsv, rows, attempts, total_wait_ms: Date.now() - start };
    }
    if (response.status === 201 || response.status === 202) {
      const retryIn = parseInt(response.headers.get("retryIn") ?? "5", 10) * 1000;
      await new Promise(r => setTimeout(r, Math.min(retryIn, 5000)));
      continue;
    }
    const errBody = await response.text();
    return { ok: false, status: response.status, error: errBody, attempts, total_wait_ms: Date.now() - start };
  }
  return { ok: false, status: 0, error: "timeout", attempts, total_wait_ms: Date.now() - start };
}
