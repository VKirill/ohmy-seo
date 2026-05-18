import { request } from "@ohmy-seo/mcp-core/http";

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
