import { resolveAccount } from "../account-resolver.js";
import { getAccessToken } from "../oauth/token-broker.js";
import { getApiSpec } from "./endpoints-spec.js";

export interface ReportPollingOpts {
  accountLabel?: string;
  clientLogin?: string;  // Client-Login header — agency sub-client login (e.g. "agency-client-login")
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

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(opts.body),
    });

    if (response.status === 200) {
      const tsv = await response.text();
      const lines = tsv.split("\n").filter(l => l.trim());
      // With skipReportHeader=false the report begins with a quoted title line
      // ("<ReportName> (<from> - <to>)") that contains no tab. Skip any such leading
      // line(s) so the real column-header row is used and data rows stay aligned.
      let h = 0;
      while (h < lines.length && !lines[h].includes("\t")) h++;
      if (lines.length - h < 2) return { ok: true, status: 200, tsv, rows: [], attempts, total_wait_ms: Date.now() - start };
      const cols = lines[h].split("\t");
      const rows = lines.slice(h + 1).map(line => {
        const values = line.split("\t");
        return Object.fromEntries(cols.map((c, i) => [c, values[i] ?? ""]));
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
