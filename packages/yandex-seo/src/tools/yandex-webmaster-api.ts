import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

export async function runYandexWebmasterApi(input: {
  endpoint: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, unknown>;
  body?: unknown;
  account?: string;
  force_refresh?: boolean;
}) {
  try {
    const result = await executeApiCall({
      apiName: "webmaster",
      endpoint: input.endpoint,
      method: input.method ?? "GET",
      params: input.params,
      body: input.body,
      account: input.account,
      force_refresh: input.force_refresh,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
