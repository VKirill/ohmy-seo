import { withCache } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_ADWORDS } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { adsSearch, digitsOnly } from "../lib/ads-client.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { PRIMARY_FIELDS } from "../lib/gaql-builder.js";

const PKG_NAME = "google-ads";
export const TOOL_NAME = "ads_resource_metadata";

/**
 * Which fields a GAQL resource actually has, and which metrics and segments
 * may be selected alongside it. Call this instead of guessing field names —
 * the answer is stable and cached for 24 hours.
 */
export async function runAdsResourceMetadata(args: {
  account?: string;
  customer_id: string;
  resource: string;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  try {
    const account = await resolveAccount(PKG_NAME, SCOPE_ADWORDS, args.account);
    const resource = args.resource.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (resource.length === 0) return asText({ error: "resource is empty" }, true);

    const customerId = digitsOnly(args.customer_id);
    const loginCustomerId = args.login_customer_id ? digitsOnly(args.login_customer_id) : undefined;

    const attributesQuery =
      "SELECT name, category, data_type, selectable, filterable, sortable, is_repeated, enum_values " +
      `FROM google_ads_field WHERE name LIKE '${resource}.%' AND category = 'ATTRIBUTE'`;
    const compatibleQuery =
      "SELECT name, category, data_type FROM google_ads_field " +
      `WHERE selectable_with CONTAINS ANY ('${resource}') ` +
      "AND category IN ('METRIC', 'SEGMENT')";

    const result = await withCache(
      {
        toolName: TOOL_NAME,
        accountId: account.id,
        args: { resource, customerId },
        forceRefresh: args.force_refresh ?? false,
        skipCacheIf: (r: unknown) => !(r as { ok?: boolean }).ok,
      },
      async () => {
        const attributes = await adsSearch(account, customerId, attributesQuery, loginCustomerId);
        if (!attributes.ok) return { ok: false as const, error: attributes.error };
        const compatible = await adsSearch(account, customerId, compatibleQuery, loginCustomerId);
        return {
          ok: true as const,
          resource,
          required_primary_field: PRIMARY_FIELDS[resource] ?? null,
          attributes: attributes.rows,
          metrics_and_segments: compatible.ok ? compatible.rows : compatible.error,
        };
      },
    );

    return asText(result, !(result as { ok?: boolean }).ok);
  } catch (e) {
    return errorToMcpContent(e) as McpText;
  }
}
