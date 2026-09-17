/**
 * ga4_archive_custom_dimension: POST v1beta/{property}/customDimensions/{id}:archive
 * Irreversible — archived custom dimensions cannot be recreated with the same
 * parameterName. Docs:
 * https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.customDimensions/archive
 * Scope: analytics.edit (SCOPE_GA4_EDIT).
 *
 * confirm:false (default) → dry-run preview, no API call, no token fetch.
 * confirm:true  → resolves account, POSTs the archive call (empty body).
 * Mirrors gtm_delete_tag's gate (plain confirm, no extra acknowledge_live step —
 * gtm only adds that second step for tools that republish a *live* container).
 */

import { deleteWhere } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_GA4_EDIT } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGa4Call } from "../lib/ga4-client.js";
import { assertConfirm, buildDryRunPreview } from "../lib/confirm-gate.js";
import { normalizeCustomDimensionName } from "../lib/ga4-resource-names.js";

const PKG_NAME = "ga4";
const ADMIN_API_BASE = "https://analyticsadmin.googleapis.com";

export interface RunGa4ArchiveCustomDimensionArgs {
  account?: string;
  property: string;
  customDimension: string;
  confirm?: boolean;
}

export async function runGa4ArchiveCustomDimension(args: RunGa4ArchiveCustomDimensionArgs) {
  try {
    const { account: accountLabel, property: propertyArg, customDimension: customDimensionArg, confirm } =
      args;

    const name = normalizeCustomDimensionName(propertyArg, customDimensionArg);
    const path = `v1beta/${name}:archive`;

    if (!confirm) {
      const preview = buildDryRunPreview(
        "POST customDimension:archive",
        { name, path },
        { warning: "Archiving a custom dimension is irreversible; the parameterName cannot be reused." }
      );
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
    });

    if (!result.ok) {
      return {
        isError: true as const,
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }],
      };
    }

    deleteWhere({ tool: "ga4_list_custom_dimensions", account_id: account.id }, PKG_NAME);

    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ archived: true, name, path }, null, 2) },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
