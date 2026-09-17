/**
 * ga4_create_key_event: POST v1beta/{property}/keyEvents — creates a key event
 * (formerly "conversion event"). Docs:
 * https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.keyEvents/create
 * Scope: analytics.edit (SCOPE_GA4_EDIT).
 *
 * confirm:false (default) → dry-run preview, no API call, no token fetch.
 * confirm:true  → resolves account, POSTs the KeyEvent body.
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

export interface RunGa4CreateKeyEventArgs {
  account?: string;
  property: string;
  eventName: string;
  countingMethod: "ONCE_PER_EVENT" | "ONCE_PER_SESSION";
  confirm?: boolean;
}

export async function runGa4CreateKeyEvent(args: RunGa4CreateKeyEventArgs) {
  try {
    const { account: accountLabel, property: propertyArg, confirm, eventName, countingMethod } = args;

    const property = normalizeProperty(propertyArg);
    const path = `v1beta/${property}/keyEvents`;
    const body = { eventName, countingMethod };

    if (!confirm) {
      const preview = buildDryRunPreview("POST keyEvent", { property, path }, body);
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

    deleteWhere({ tool: "ga4_list_conversion_events", account_id: account.id }, PKG_NAME);

    return { content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
