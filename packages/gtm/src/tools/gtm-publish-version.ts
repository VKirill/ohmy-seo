import { SCOPE_GTM_PUBLISH } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";
import {
  assertAcknowledgeLive,
} from "../lib/confirm-gate.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_publish_version";

export const schema = {
  name: TOOL_NAME,
  description:
    "DANGER — affects live container. Publishes a specific GTM container version, making it live. " +
    "Verify version_id is the intended checkpoint. " +
    "Two-step gate: confirm:true + acknowledge_live:'I-UNDERSTAND-THIS-IS-LIVE:<version_id>'. " +
    "With confirm:false (default) returns a dry-run preview with the target version and a warning.",
  annotations: {
    readOnlyHint: false,
  },
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description: "Label of a registered Google account (optional; uses default if omitted).",
      },
      accountId: {
        type: "string",
        description: "GTM Account ID (numeric string).",
      },
      containerId: {
        type: "string",
        description: "GTM Container ID (numeric string).",
      },
      versionId: {
        type: "string",
        description: "Target GTM Container Version ID to make live.",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute publish. False (default) returns dry-run preview.",
        default: false,
      },
      acknowledge_live: {
        type: "string",
        description:
          "Required when confirm:true. Must be: I-UNDERSTAND-THIS-IS-LIVE:<versionId>",
      },
    },
    required: ["accountId", "containerId", "versionId"],
  },
};

export async function runGtmPublishVersion(args: {
  account?: string;
  accountId: string;
  containerId: string;
  versionId: string;
  confirm?: boolean;
  acknowledge_live?: string;
}) {
  // Step 1 — dry-run preview (confirm: false or absent)
  if (!args.confirm) {
    return {
      dry_run: true,
      operation: "publish_version",
      target: {
        accountId: args.accountId,
        containerId: args.containerId,
        versionId: args.versionId,
      },
      warning:
        "Publishing version makes it LIVE immediately. This cannot be undone without a rollback.",
      next_step:
        `Re-run with confirm:true and acknowledge_live:'I-UNDERSTAND-THIS-IS-LIVE:${args.versionId}' to execute.`,
    };
  }

  // Step 2 — pre-check scope BEFORE any API call (resolveAccount throws InsufficientScopeError)
  // tagmanager.publish scope must be in account.scopes_granted
  const account = await resolveAccount(PKG_NAME, SCOPE_GTM_PUBLISH, args.account);

  // Step 3 — acknowledge_live gate (format: I-UNDERSTAND-THIS-IS-LIVE:<versionId>)
  assertAcknowledgeLive(args, args.versionId);

  // Step 4 — execute publish
  const path =
    `accounts/${args.accountId}/containers/${args.containerId}` +
    `/versions/${args.versionId}:publish`;

  const result = await executeGtmCall({
    account,
    scope: SCOPE_GTM_PUBLISH,
    method: "POST",
    path,
  });

  return result.data;
}
