// DANGER — DELETE /accounts/{aid}/user_permissions/{permissionId}
// Docs: https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.user_permissions/delete
// Required scope: tagmanager.manage.users
// Revokes a user's access to the account AND all of its containers. Irreversible (must be re-granted
// via gtm_create_user_permission).
// Two-step gate: confirm:true + acknowledge_live:'I-UNDERSTAND-THIS-IS-LIVE:<permissionId>'.

import { SCOPE_GTM_MANAGE_USERS } from "@ohmy-seo/mcp-core/google-oauth";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";
import { assertAcknowledgeLive } from "../lib/confirm-gate.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_delete_user_permission";

export const schema = {
  name: TOOL_NAME,
  description:
    "DANGER — revokes a user's access to a GTM account and all of its containers. Verify permissionId " +
    "with gtm_list_user_permissions first. Two-step gate: confirm:true + " +
    "acknowledge_live:'I-UNDERSTAND-THIS-IS-LIVE:<permissionId>'. With confirm:false (default) returns " +
    "a dry-run preview with a warning.",
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description: "Label of a registered Google account (optional; uses default if omitted).",
      },
      accountId: { type: "string", description: "GTM Account ID (numeric string)." },
      permissionId: { type: "string", description: "UserPermission ID to revoke." },
      confirm: {
        type: "boolean",
        default: false,
        description: "Set to true to execute the delete. False (default) returns dry-run preview.",
      },
      acknowledge_live: {
        type: "string",
        description: "Required when confirm:true. Must be: I-UNDERSTAND-THIS-IS-LIVE:<permissionId>",
      },
    },
    required: ["accountId", "permissionId"],
  },
};

export async function runGtmDeleteUserPermission(args: {
  account?: string;
  accountId: string;
  permissionId: string;
  confirm?: boolean;
  acknowledge_live?: string;
}) {
  try {
    const path = `accounts/${args.accountId}/user_permissions/${args.permissionId}`;

    // Step 1 — dry-run preview (confirm: false or absent)
    if (!args.confirm) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                dry_run: true,
                operation: "delete_user_permission",
                target: { accountId: args.accountId, permissionId: args.permissionId, path },
                warning:
                  "Revokes the user's access to this account AND all of its containers. Irreversible " +
                  "(must be re-granted via gtm_create_user_permission).",
                next_step:
                  `Re-run with confirm:true and acknowledge_live:'I-UNDERSTAND-THIS-IS-LIVE:${args.permissionId}' to execute.`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // Step 2 — pre-check scope BEFORE any API call
    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_MANAGE_USERS, args.account);

    // Step 3 — acknowledge_live gate
    assertAcknowledgeLive(args, args.permissionId);

    // Step 4 — execute delete
    const result = await executeGtmCall({
      account,
      scope: SCOPE_GTM_MANAGE_USERS,
      method: "DELETE",
      path,
    });

    const responseText =
      result.ok
        ? JSON.stringify({ deleted: true, permissionId: args.permissionId, path }, null, 2)
        : JSON.stringify(result.data, null, 2);

    return { content: [{ type: "text" as const, text: responseText }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
