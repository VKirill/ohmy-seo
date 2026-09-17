// DANGER — DELETE /accounts/{aid}/containers/{cid}
// Docs: https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers/delete
// Required scope: tagmanager.delete.containers
// Irreversible: destroys the container and every tag/trigger/variable/version inside it.
// Two-step gate: confirm:true + acknowledge_live:'I-UNDERSTAND-THIS-IS-LIVE:<containerId>'.

import { SCOPE_GTM_DELETE_CONTAINERS } from "@ohmy-seo/mcp-core/google-oauth";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";
import { assertAcknowledgeLive } from "../lib/confirm-gate.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_delete_container";

export const schema = {
  name: TOOL_NAME,
  description:
    "DANGER — irreversibly deletes a GTM Container and everything inside it (tags, triggers, " +
    "variables, workspaces, versions). Verify containerId with gtm_list_containers first. " +
    "Two-step gate: confirm:true + acknowledge_live:'I-UNDERSTAND-THIS-IS-LIVE:<containerId>'. " +
    "With confirm:false (default) returns a dry-run preview with a warning.",
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description: "Label of a registered Google account (optional; uses default if omitted).",
      },
      accountId: { type: "string", description: "GTM Account ID (numeric string)." },
      containerId: { type: "string", description: "GTM Container ID to delete (numeric string)." },
      confirm: {
        type: "boolean",
        default: false,
        description: "Set to true to execute the delete. False (default) returns dry-run preview.",
      },
      acknowledge_live: {
        type: "string",
        description: "Required when confirm:true. Must be: I-UNDERSTAND-THIS-IS-LIVE:<containerId>",
      },
    },
    required: ["accountId", "containerId"],
  },
};

export async function runGtmDeleteContainer(args: {
  account?: string;
  accountId: string;
  containerId: string;
  confirm?: boolean;
  acknowledge_live?: string;
}) {
  try {
    const path = `accounts/${args.accountId}/containers/${args.containerId}`;

    // Step 1 — dry-run preview (confirm: false or absent)
    if (!args.confirm) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                dry_run: true,
                operation: "delete_container",
                target: { accountId: args.accountId, containerId: args.containerId, path },
                warning:
                  "Deleting a container is IRREVERSIBLE and destroys all tags, triggers, variables, " +
                  "workspaces, and versions inside it.",
                next_step:
                  `Re-run with confirm:true and acknowledge_live:'I-UNDERSTAND-THIS-IS-LIVE:${args.containerId}' to execute.`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // Step 2 — pre-check scope BEFORE any API call
    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_DELETE_CONTAINERS, args.account);

    // Step 3 — acknowledge_live gate
    assertAcknowledgeLive(args, args.containerId);

    // Step 4 — execute delete
    const result = await executeGtmCall({
      account,
      scope: SCOPE_GTM_DELETE_CONTAINERS,
      method: "DELETE",
      path,
    });

    const responseText =
      result.status === 204
        ? JSON.stringify({ deleted: true, containerId: args.containerId, path }, null, 2)
        : JSON.stringify(result.data, null, 2);

    return { content: [{ type: "text" as const, text: responseText }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
