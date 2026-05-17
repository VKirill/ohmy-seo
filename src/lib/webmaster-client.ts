import { request } from "./http.js";

const BASE_URL = "https://api.webmaster.yandex.net/v4";

// host: 'https:example.com:443' or 'http:example.com:80' or plain 'example.com'
// Also accepts 'https://example.com' and normalizes.
export function encodeHostId(host: string): string {
  let id = host;
  if (host.startsWith("https://") || host.startsWith("http://")) {
    const url = new URL(host);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    id = `${url.protocol.replace(":", "")}:${url.hostname}:${port}`;
  } else if (!host.includes(":")) {
    // bare 'example.com' → assume https:443
    id = `https:${host}:443`;
  }
  return encodeURIComponent(id);
}

export interface SiteSummary {
  host_id: string;
  verified: boolean;
  sqi: number | null;
  indexed_pages: number | null;
  last_access_date: string | null;
  problems_count: { fatal: number; critical: number; error: number; warning: number };
}

export async function getSiteSummary(p: { accessToken: string; webmasterUserId: string; host: string }): Promise<SiteSummary> {
  const hostId = encodeHostId(p.host);
  const headers = { Authorization: "OAuth " + p.accessToken };

  const [hostResp, summaryResp] = await Promise.all([
    request(`${BASE_URL}/user/${p.webmasterUserId}/hosts/${hostId}`, { headers }),
    request(`${BASE_URL}/user/${p.webmasterUserId}/hosts/${hostId}/summary`, { headers }),
  ]);

  const hostData = hostResp.data as Record<string, unknown>;
  const summaryData = summaryResp.data as Record<string, unknown>;

  const verification = hostData["verification"] as Record<string, unknown> | undefined;
  const verified = verification?.["state"] === "VERIFIED";

  const sqi = typeof summaryData["site_quality_index"] === "number"
    ? (summaryData["site_quality_index"] as number)
    : null;

  const crawlSummary = summaryData["indexed_pages_count"];
  const indexedPages = typeof crawlSummary === "number" ? crawlSummary : null;

  const lastAccess = typeof hostData["last_access_date"] === "string"
    ? (hostData["last_access_date"] as string)
    : null;

  const counts = (summaryData["problems_count"] as Record<string, number> | undefined) ?? {};

  return {
    host_id: p.host,
    verified,
    sqi,
    indexed_pages: indexedPages,
    last_access_date: lastAccess,
    problems_count: {
      fatal: counts["FATAL"] ?? 0,
      critical: counts["CRITICAL"] ?? 0,
      error: counts["ERROR"] ?? 0,
      warning: counts["WARNING"] ?? 0,
    },
  };
}

export interface TopQuery {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number | null;
}

export interface TopQueriesResult {
  host_id: string;
  date_from: string;
  date_to: string;
  queries: TopQuery[];
}

export async function getTopQueries(p: {
  accessToken: string;
  webmasterUserId: string;
  host: string;
  dateFrom: string;
  dateTo: string;
  limit: number;
  orderBy?: string;
  queryFilter?: string;
}): Promise<TopQueriesResult> {
  const hostId = encodeHostId(p.host);
  const order_by = p.orderBy ?? "IMPRESSIONS";

  const params = new URLSearchParams({
    order_by,
    date_from: p.dateFrom,
    date_to: p.dateTo,
    limit: String(p.limit),
  });

  const { data } = await request(
    `${BASE_URL}/user/${p.webmasterUserId}/hosts/${hostId}/search-queries/popular/?${params}`,
    { headers: { Authorization: "OAuth " + p.accessToken } },
  );

  const raw = data as Record<string, unknown>;
  const queries = Array.isArray(raw["queries"]) ? raw["queries"] : [];

  const result: TopQuery[] = [];
  for (const q of queries) {
    const qr = q as Record<string, unknown>;
    const text = typeof qr["query_text"] === "string" ? qr["query_text"] : "";
    if (p.queryFilter && !text.includes(p.queryFilter)) continue;

    result.push({
      query: text,
      impressions: typeof qr["impressions"] === "number" ? qr["impressions"] : 0,
      clicks: typeof qr["clicks"] === "number" ? qr["clicks"] : 0,
      ctr: typeof qr["ctr"] === "number" ? qr["ctr"] : 0,
      position: typeof qr["position"] === "number" ? qr["position"] : null,
    });
  }

  return {
    host_id: p.host,
    date_from: p.dateFrom,
    date_to: p.dateTo,
    queries: result,
  };
}

export interface HostInfo {
  host_id: string;
  ascii_host_url: string;
  unicode_host_url?: string;
  verified: boolean;
  main_mirror: boolean;
}

export async function getHostsList(p: { accessToken: string; webmasterUserId: string }): Promise<HostInfo[]> {
  const { data } = await request(
    `${BASE_URL}/user/${p.webmasterUserId}/hosts`,
    { headers: { Authorization: "OAuth " + p.accessToken } },
  );

  const raw = data as Record<string, unknown>;
  const hosts = Array.isArray(raw["hosts"]) ? raw["hosts"] : [];

  if (hosts.length === 100) {
    console.error("[warn] Webmaster hosts may be truncated (pagination not yet supported in v0.3)");
  }

  return hosts.map((h) => {
    const item = h as Record<string, unknown>;
    return {
      host_id: typeof item["host_id"] === "string" ? item["host_id"] : "",
      ascii_host_url: typeof item["ascii_host_url"] === "string" ? item["ascii_host_url"] : "",
      unicode_host_url: typeof item["unicode_host_url"] === "string" ? item["unicode_host_url"] : undefined,
      verified: item["verified"] === true,
      main_mirror: item["main_mirror"] === true,
    };
  });
}

export interface DiagnosticIssue {
  indicator: string;
  severity: string;
  affected_urls: number;
}

export interface IndexingIssuesResult {
  host_id: string;
  issues: DiagnosticIssue[];
  total: number;
}

export async function getIndexingIssues(p: { accessToken: string; webmasterUserId: string; host: string }): Promise<IndexingIssuesResult> {
  const hostId = encodeHostId(p.host);

  const { data } = await request(
    `${BASE_URL}/user/${p.webmasterUserId}/hosts/${hostId}/diagnostics`,
    { headers: { Authorization: "OAuth " + p.accessToken } },
  );

  const raw = data as Record<string, unknown>;
  const diagnostics = Array.isArray(raw["diagnostics"]) ? raw["diagnostics"] : [];

  const issues: DiagnosticIssue[] = diagnostics.map((d) => {
    const item = d as Record<string, unknown>;
    return {
      indicator: typeof item["indicator"] === "string" ? item["indicator"] : "",
      severity: typeof item["priority"] === "string" ? item["priority"] : "UNKNOWN",
      affected_urls: typeof item["affected_urls_count"] === "number" ? item["affected_urls_count"] : 0,
    };
  });

  return { host_id: p.host, issues, total: issues.length };
}
