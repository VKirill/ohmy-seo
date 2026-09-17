/**
 * ga4_update_custom_dimension: PATCH v1beta/{property}/customDimensions/{id} —
 * updates displayName, description and/or disallowAdsPersonalization. Docs:
 * https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.customDimensions/patch
 * Scope: analytics.edit (SCOPE_GA4_EDIT).
 *
 * confirm:false (default) → dry-run preview, no API call, no token fetch.
 * confirm:true  → resolves account, PATCHes with an updateMask built from the
 *                 fields actually provided.
 */

import { deleteWhere } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_GA4_EDIT } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGa4Call } from "../lib/ga4-client.js";
import { assertConfirm, buildDryRunPreview } from "../lib/confirm-gate.js";
import { normalizeCustomDimensionName, toUpdateMask } from "../lib/ga4-resource-names.js";

const PKG_NAME = "ga4";
const ADMIN_API_BASE = "https://analyticsadmin.googleapis.com";

export interface RunGa4UpdateCustomDimensionArgs {
  account?: string;
  property: string;
  customDimension: string;
  displayName?: string;
  description?: string;
  disallowAdsPersonalization?: boolean;
  confirm?: boolean;
}

export async function runGa4UpdateCustomDimension(args: RunGa4UpdateCustomDimensionArgs) {
  try {
    const {
      account: accountLabel,
      property: propertyArg,
      customDimension: customDimensionArg,
      confirm,
      ...fields
    } = args;

    const name = normalizeCustomDimensionName(propertyArg, customDimensionArg);
    const path = `v1beta/${name}`;

    const provided = Object.entries(fields).filter(([, v]) => v !== undefined) as Array<
      [string, string | boolean]
    >;

    if (provided.length === 0) {
      return {
        isError: true as const,
        content: [
          {
            type: "text" as const,
            text:
              "At least one field to update must be provided: " +
              "displayName, description, disallowAdsPersonalization.",
          },
        ],
      };
    }

    const body = Object.fromEntries(provided);
    const updateMask = toUpdateMask(provided.map(([k]) => k));

    if (!confirm) {
      const preview = buildDryRunPreview("PATCH customDimension", { name, path }, body);
      return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
    }

    assertConfirm({ confirm });

    const account = await resolveAccount(PKG_NAME, SCOPE_GA4_EDIT, accountLabel);

    const result = await executeGa4Call({
      account,
      scope: SCOPE_GA4_EDIT,
      method: "PATCH",
      path,
      baseUrl: ADMIN_API_BASE,
      query: { updateMask },
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
