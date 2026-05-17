import { request } from "./http.js";

const BASE_URL = "https://api-metrika.yandex.net/stat/v1/data";

const MANAGEMENT_BASE_URL = "https://api-metrika.yandex.net/management/v1";

export interface CounterInfo {
  counter_id: string;
  name: string | null;
  site: string | null;
  status: string | null;
  permission: string | null;
}

export async function getCountersList(p: { accessToken: string }): Promise<CounterInfo[]> {
  const { data } = await request(
    `${MANAGEMENT_BASE_URL}/counters?per_page=100`,
    { headers: { Authorization: "OAuth " + p.accessToken } },
  );

  const raw = data as Record<string, unknown>;
  const counters = Array.isArray(raw["counters"]) ? raw["counters"] : [];

  if (counters.length === 100) {
    console.error("[warn] Metrika counters may be truncated (pagination not yet supported in v0.3)");
  }

  return counters.map((c) => {
    const item = c as Record<string, unknown>;
    return {
      counter_id: String((item["id"] as number | string) ?? ""),
      name: typeof item["name"] === "string" ? item["name"] : null,
      site: typeof item["site"] === "string" ? item["site"] : null,
      status: typeof item["status"] === "string" ? item["status"] : null,
      permission: typeof item["permission"] === "string" ? item["permission"] : null,
    };
  });
}

export interface SearchPhraseRow {
  phrase: string;
  visits: number;
  bounce_rate: number;
  page_depth: number;
  engine: string;
}

export async function getSearchPhrases(p: {
  accessToken: string;
  counterId: string;
  dateFrom: string;
  dateTo: string;
  limit: number;
  searchEngine: "yandex" | "google" | "all";
}): Promise<{ counter_id: string; period: { from: string; to: string }; phrases: SearchPhraseRow[] }> {
  let filter = "ym:s:trafficSourceName=='Переходы из поисковых систем'";
  if (p.searchEngine === "yandex") {
    filter += " AND ym:s:searchEngine=='Яндекс'";
  } else if (p.searchEngine === "google") {
    filter += " AND ym:s:searchEngine=='Google'";
  }

  const params = new URLSearchParams({
    ids: p.counterId,
    dimensions: "ym:s:searchPhrase,ym:s:searchEngine",
    metrics: "ym:s:visits,ym:s:bounceRate,ym:s:pageDepth",
    filters: filter,
    date1: p.dateFrom,
    date2: p.dateTo,
    limit: String(p.limit),
    sort: "-ym:s:visits",
  });

  const { data } = await request(`${BASE_URL}?${params}`, {
    headers: { Authorization: "OAuth " + p.accessToken },
  });

  const raw = data as Record<string, unknown>;
  const rows = Array.isArray(raw["data"]) ? raw["data"] : [];

  const phrases: SearchPhraseRow[] = rows.map((row) => {
    const r = row as Record<string, unknown>;
    const dims = Array.isArray(r["dimensions"]) ? r["dimensions"] : [];
    const metrics = Array.isArray(r["metrics"]) ? r["metrics"] : [];

    const dim0 = dims[0] as Record<string, unknown> | undefined;
    const dim1 = dims[1] as Record<string, unknown> | undefined;

    return {
      phrase: typeof dim0?.["name"] === "string" ? dim0["name"] : "",
      engine: typeof dim1?.["name"] === "string" ? dim1["name"] : "",
      visits: typeof metrics[0] === "number" ? metrics[0] : 0,
      bounce_rate: typeof metrics[1] === "number" ? metrics[1] : 0,
      page_depth: typeof metrics[2] === "number" ? metrics[2] : 0,
    };
  });

  return {
    counter_id: p.counterId,
    period: { from: p.dateFrom, to: p.dateTo },
    phrases,
  };
}

export interface TrafficSourceRow {
  source: string;
  visits: number;
  users: number;
  pageviews: number;
  bounce_rate: number;
}

export async function getTrafficSummary(p: {
  accessToken: string;
  counterId: string;
  dateFrom: string;
  dateTo: string;
  groupBy: "day" | "week" | "month" | "none";
}): Promise<{ counter_id: string; period: { from: string; to: string }; by_source: TrafficSourceRow[] }> {
  const params = new URLSearchParams({
    ids: p.counterId,
    dimensions: "ym:s:trafficSource",
    metrics: "ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate",
    date1: p.dateFrom,
    date2: p.dateTo,
  });

  if (p.groupBy !== "none") {
    params.set("group", p.groupBy);
  }

  const { data } = await request(`${BASE_URL}?${params}`, {
    headers: { Authorization: "OAuth " + p.accessToken },
  });

  const raw = data as Record<string, unknown>;
  const rows = Array.isArray(raw["data"]) ? raw["data"] : [];

  const by_source: TrafficSourceRow[] = rows.map((row) => {
    const r = row as Record<string, unknown>;
    const dims = Array.isArray(r["dimensions"]) ? r["dimensions"] : [];
    const metrics = Array.isArray(r["metrics"]) ? r["metrics"] : [];

    const dim0 = dims[0] as Record<string, unknown> | undefined;

    return {
      source: typeof dim0?.["name"] === "string" ? dim0["name"] : "",
      visits: typeof metrics[0] === "number" ? metrics[0] : 0,
      users: typeof metrics[1] === "number" ? metrics[1] : 0,
      pageviews: typeof metrics[2] === "number" ? metrics[2] : 0,
      bounce_rate: typeof metrics[3] === "number" ? metrics[3] : 0,
    };
  });

  return {
    counter_id: p.counterId,
    period: { from: p.dateFrom, to: p.dateTo },
    by_source,
  };
}
