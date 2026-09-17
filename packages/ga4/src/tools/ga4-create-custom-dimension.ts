/**
 * ga4_create_custom_dimension: POST v1beta/{property}/customDimensions — creates
 * a custom dimension. Docs:
 * https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.customDimensions/create
 * Scope: analytics.edit (SCOPE_GA4_EDIT).
 *
 * confirm:false (default) → dry-run preview, no API call, no token fetch.
 * confirm:true  → resolves account, POSTs the CustomDimension body.
 */

import { deleteWhere } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_GA4_EDIT } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGa4Call } from "../lib/ga4-client.js";
import { assertConfirm, buildDryRunPreview } from "../lib/confirm-gate.js";
import { normalizeProperty } from "../lib/ga4-resource-names.js";

const PKG_NAME = "ga4";
const ADMIN_API_BASE = "https://analyticsadmin.googleapis.com";

export interface RunGa4CreateCustomDimensionArgs {
  account?: string;
  property: string;
  parameterName: string;
  displayName: string;
  scope: "EVENT" | "USER" | "ITEM";
  description?: string;
  disallowAdsPersonalization?: boolean;
  confirm?: boolean;
}

export async function runGa4CreateCustomDimension(args: RunGa4CreateCustomDimensionArgs) {
  try {
    const {
      account: accountLabel,
      property: propertyArg,
      confirm,
      disallowAdsPersonalization,
      scope,
      ...rest
    } = args;

    if (disallowAdsPersonalization !== undefined && scope !== "USER") {
      return {
        isError: true as const,
        content: [
          {
            type: "text" as const,
            text: "disallowAdsPersonalization is only valid when scope is USER.",
          },
        ],
      };
    }

    const property = normalizeProperty(propertyArg);
    const path = `v1beta/${property}/customDimensions`;

    const body: Record<string, unknown> = { ...rest, scope };
    if (disallowAdsPersonalization !== undefined) {
      body.disallowAdsPersonalization = disallowAdsPersonalization;
    }

    if (!confirm) {
      const preview = buildDryRunPreview("POST customDimension", { property, path }, body);
      return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
    }

    assertConfirm({ confirm });

    const account = await resolveAccount(PKG_NAME, SCOPE_GA4_EDIT, accountLabel);

    const result = await executeGa4Call({
      account,
      scope: SCOPE_GA4_EDIT,
      method: "POST",
      path,
      baseUrl: ADMIN_API_BASE,
      body,
    });

    if (!result.ok) {
      return {
        isError: true as const,
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }],
      };
    }

    deleteWhere({ tool: "ga4_list_custom_dimensions", account_id: account.id }, PKG_NAME);

    return { content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
