// PUT /accounts/{aid}
// Docs: https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts/update
// Required scope: tagmanager.manage.accounts
//
// Concurrency: unlike tags (which have a gtm_get_tag/gtm_list_tags read path that can pre-populate
// the etag cache), there is no per-account read tool in this package, so gtm_list_accounts' cached
// etag (keyed by the LIST path "accounts", not "accounts/{id}") cannot satisfy executeGtmCall's
// requireEtag lookup for the item path. Per package convention (see gtm-client.ts / etag-cache.ts),
// this tool fetches the current Account resource first (GET accounts/{aid}), which both captures a
// fresh If-Match token under the exact item path AND supplies the current field values so the PUT
// sends the full resource (GTM's account fields are few: name, shareData).
//
// confirm:false → dry-run preview (NO network call at all); confirm:true → GET then PUT.

import { SCOPE_GTM_MANAGE_ACCOUNTS } from "@ohmy-seo/mcp-core/google-oauth";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";
import { assertConfirm, buildDryRunPreview } from "../lib/confirm-gate.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_update_account";

export const schema = {
  name: TOOL_NAME,
  description:
    "WRITE — updates a GTM Account (name, shareData). Fetches the current account first to obtain " +
    "a fresh fingerprint/etag and the full resource (GTM has no dedicated single-account read tool), " +
    "then PUTs the merged resource. confirm:false returns dry-run preview with NO network call; " +
    "confirm:true executes the read + update.",
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: "object" as const,
    properties: {
      account: { type: "string", description: "Registered Google account label (optional)." },
      accountId: { type: "string", description: "GTM Account ID to update." },
      name: { type: "string", description: "Account display name." },
      shareData: { type: "boolean", description: "Whether data may be shared anonymously with Google." },
      confirm: { type: "boolean", default: false, description: "true = execute; false = dry-run preview." },
    },
    required: ["accountId"],
  },
};

export async function runGtmUpdateAccount(args: {
  account?: string;
  accountId: string;
  name?: string;
  shareData?: boolean;
  confirm?: boolean;
}) {
  try {
    const { account: accountLabel, accountId, name, shareData, confirm } = args;
    const path = `accounts/${accountId}`;

    if (!confirm) {
      const preview = buildDryRunPreview(
        "PUT account (read-then-write)",
        { accountId, path },
        { name, shareData }
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
    }

    assertConfirm({ confirm });

    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_MANAGE_ACCOUNTS, accountLabel);

    // Read current resource first — captures a fresh If-Match token for `path` and gives us the
    // full writable field set so the PUT doesn't silently drop unspecified fields.
    const current = await executeGtmCall({
      account,
      scope: SCOPE_GTM_MANAGE_ACCOUNTS,
      method: "GET",
      path,
    });
    if (!current.ok) {
      throw new Error(`Failed to read current account ${accountId} before update: HTTP ${current.status}`);
    }
    const currentData = current.data as Record<string, unknown>;

    const body: Record<string, unknown> = {
      accountId,
      name: name ?? currentData["name"],
      shareData: shareData ?? currentData["shareData"],
    };

    const result = await executeGtmCall({
      account,
      scope: SCOPE_GTM_MANAGE_ACCOUNTS,
      method: "PUT",
      path,
      body,
      requireEtag: true,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
