import { SCOPE_GTM_EDIT_VERSIONS } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";
import {
  assertConfirm,
  buildDryRunPreview,
  ConfirmRequiredError,
} from "../lib/confirm-gate.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_create_version";

export const schema = {
  name: TOOL_NAME,
  description:
    "Creates a checkpoint from current workspace state. Does NOT publish — workspace remains active. Use gtm_publish_version separately to make this version live. " +
    "With confirm:false (default) returns a dry-run preview showing the target workspace and what will be checkpointed. " +
    "With confirm:true executes the create_version call.",
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
      workspaceId: {
        type: "string",
        description: "GTM Workspace ID (numeric string).",
      },
      name: {
        type: "string",
        description: "Version name (human-readable label for the checkpoint).",
      },
      notes: {
        type: "string",
        description: "Optional notes describing what changed in this version.",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute. False (default) returns dry-run preview.",
      },
    },
    required: ["accountId", "containerId", "workspaceId", "name", "confirm"],
  },
};

export async function runGtmCreateVersion(args: {
  account?: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
  name: string;
  notes?: string;
  confirm: boolean;
}) {
  const account = await resolveAccount(PKG_NAME, SCOPE_GTM_EDIT_VERSIONS, args.account);

  try {
    assertConfirm(args);
  } catch (e) {
    if (e instanceof ConfirmRequiredError) {
      return buildDryRunPreview(
        "create_version",
        {
          accountId: args.accountId,
          containerId: args.containerId,
          workspaceId: args.workspaceId,
        },
        {
          name: args.name,
          notes: args.notes ?? null,
        }
      );
    }
    throw e;
  }

  const path =
    `accounts/${args.accountId}/containers/${args.containerId}` +
    `/workspaces/${args.workspaceId}:create_version`;

  const body: Record<string, unknown> = { name: args.name };
  if (args.notes !== undefined) {
    body.notes = args.notes;
  }

  const result = await executeGtmCall({
    account,
    scope: SCOPE_GTM_EDIT_VERSIONS,
    method: "POST",
    path,
    body,
  });

  return result.data;
}
