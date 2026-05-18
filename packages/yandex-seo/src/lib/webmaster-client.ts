import { request } from "@ohmy-seo/mcp-core/http";

const BASE_URL = "https://api.webmaster.yandex.net/v4";

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
