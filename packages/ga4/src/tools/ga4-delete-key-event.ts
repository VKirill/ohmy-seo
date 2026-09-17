/**
 * ga4_delete_key_event: DELETE v1beta/{property}/keyEvents/{id} — irreversible.
 * Docs:
 * https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.keyEvents/delete
 * Scope: analytics.edit (SCOPE_GA4_EDIT).
 *
 * confirm:false (default) → dry-run preview, no API call, no token fetch.
 * confirm:true  → resolves account, DELETEs the key event.
 * Mirrors gtm_delete_tag's gate (plain confirm, no extra acknowledge_live step —
 * gtm only adds that second step for tools that republish a *live* container).
 */

import { deleteWhere } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_GA4_EDIT } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGa4Call } from "../lib/ga4-client.js";
import { assertConfirm, buildDryRunPreview } from "../lib/confirm-gate.js";
import { normalizeKeyEventName } from "../lib/ga4-resource-names.js";

const PKG_NAME = "ga4";
const ADMIN_API_BASE = "https://analyticsadmin.googleapis.com";

export interface RunGa4DeleteKeyEventArgs {
  account?: string;
  property: string;
  keyEvent: string;
  confirm?: boolean;
}

export async function runGa4DeleteKeyEvent(args: RunGa4DeleteKeyEventArgs) {
  try {
    const { account: accountLabel, property: propertyArg, keyEvent: keyEventArg, confirm } = args;

    const name = normalizeKeyEventName(propertyArg, keyEventArg);
    const path = `v1beta/${name}`;

    if (!confirm) {
      const preview = buildDryRunPreview(
        "DELETE keyEvent",
        { name, path },
        { warning: "Deleting a key event is irreversible." }
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
    }

    assertConfirm({ confirm });

    const account = await resolveAccount(PKG_NAME, SCOPE_GA4_EDIT, accountLabel);

    const result = await executeGa4Call({
      account,
      scope: SCOPE_GA4_EDIT,
      method: "DELETE",
      path,
      baseUrl: ADMIN_API_BASE,
    });

    if (!result.ok) {
      return {
        isError: true as const,
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }],
      };
    }

    deleteWhere({ tool: "ga4_list_conversion_events", account_id: account.id }, PKG_NAME);

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, name, path }, null, 2) }],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
