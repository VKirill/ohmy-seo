import { withCache } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_ADWORDS } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "./account-resolver.js";
import { adsSearch, digitsOnly, type AdsSearchResult } from "./ads-client.js";

const PKG_NAME = "google-ads";

export const TTL_META = { ttlEnvKey: "MCP_GOOGLE_ADS_CACHE_TTL_META", ttlDefaultSeconds: 86_400 };
export const TTL_REPORT = { ttlEnvKey: "MCP_GOOGLE_ADS_CACHE_TTL_REPORT", ttlDefaultSeconds: 3_600 };

/** Keeps a large result from swallowing the model's context window. */
const MAX_TEXT = 25_000;

export interface McpText {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

export function asText(payload: unknown, isError = false): McpText {
  let text = JSON.stringify(payload, null, 2);
  if (text.length > MAX_TEXT) {
    text =
      text.slice(0, MAX_TEXT) +
      `\n… обрезано на ${MAX_TEXT} символах. Сузьте период, добавьте фильтр или LIMIT.`;
  }
  return isError
    ? { isError: true as const, content: [{ type: "text" as const, text }] }
    : { content: [{ type: "text" as const, text }] };
}

export interface GaqlToolArgs {
  toolName: string;
  account?: string;
  customerId: string;
  query: string;
  loginCustomerId?: string;
  forceRefresh?: boolean;
  warnings?: string[];
}

/**
 * Shared body of every read/report tool: resolve account, run GAQL through the
 * cache, shape the answer. Cache is skipped for failed calls.
 */
export async function runGaqlTool(args: GaqlToolArgs): Promise<McpText> {
  try {
    const account = await resolveAccount(PKG_NAME, SCOPE_ADWORDS, args.account);
    const customerId = digitsOnly(args.customerId);
    if (customerId.length === 0) {
      return asText({ error: "customer_id is empty after stripping non-digits." }, true);
    }

    const result = await withCache(
      {
        toolName: args.toolName,
        accountId: account.id,
        args: { customerId, query: args.query, loginCustomerId: args.loginCustomerId ?? null },
        forceRefresh: args.forceRefresh ?? false,
        skipCacheIf: (r: unknown) => !(r as AdsSearchResult).ok,
      },
      () =>
        adsSearch(
          account,
          customerId,
          args.query,
          args.loginCustomerId ? digitsOnly(args.loginCustomerId) : undefined,
        ),
    );

    if (!result.ok) {
      return asText({ query: args.query, ...result }, true);
    }

    const payload: Record<string, unknown> = {
      customer_id: customerId,
      query: args.query,
      row_count: result.row_count,
      rows: result.rows,
    };
    if (result.login_customer_id) payload["via_manager"] = result.login_customer_id;
    if (args.warnings && args.warnings.length > 0) payload["warnings"] = args.warnings;
    return asText(payload);
  } catch (e) {
    return errorToMcpContent(e) as McpText;
  }
}
