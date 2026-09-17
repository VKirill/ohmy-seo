/**
 * ga4_update_data_retention: PATCH v1beta/{property}/dataRetentionSettings —
 * updates eventDataRetention, userDataRetention and/or resetUserDataOnNewActivity.
 * Docs:
 * https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties/updateDataRetentionSettings
 * Scope: analytics.edit (SCOPE_GA4_EDIT).
 *
 * confirm:false (default) → dry-run preview, no API call, no token fetch.
 * confirm:true  → resolves account, PATCHes with an updateMask built from the
 *                 fields actually provided.
 */

import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_GA4_EDIT } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGa4Call } from "../lib/ga4-client.js";
import { assertConfirm, buildDryRunPreview } from "../lib/confirm-gate.js";
import { normalizeProperty, toUpdateMask } from "../lib/ga4-resource-names.js";

const PKG_NAME = "ga4";
const ADMIN_API_BASE = "https://analyticsadmin.googleapis.com";

export type RetentionDuration =
  | "TWO_MONTHS"
  | "FOURTEEN_MONTHS"
  | "TWENTY_SIX_MONTHS"
  | "THIRTY_EIGHT_MONTHS"
  | "FIFTY_MONTHS";

export interface RunGa4UpdateDataRetentionArgs {
  account?: string;
  property: string;
  eventDataRetention?: RetentionDuration;
  userDataRetention?: RetentionDuration;
  resetUserDataOnNewActivity?: boolean;
  confirm?: boolean;
}

// No dedicated ga4_get_data_retention read/list tool exists yet, so there is no
// cache to invalidate here (unlike the other write tools in this package).
export async function runGa4UpdateDataRetention(args: RunGa4UpdateDataRetentionArgs) {
  try {
    const { account: accountLabel, property: propertyArg, confirm, ...fields } = args;

    const property = normalizeProperty(propertyArg);
    const path = `v1beta/${property}/dataRetentionSettings`;

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
              "eventDataRetention, userDataRetention, resetUserDataOnNewActivity.",
          },
        ],
      };
    }

    const body = Object.fromEntries(provided);
    const updateMask = toUpdateMask(provided.map(([k]) => k));

    if (!confirm) {
      const preview = buildDryRunPreview("PATCH dataRetentionSettings", { property, path }, body);
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

    return { content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
