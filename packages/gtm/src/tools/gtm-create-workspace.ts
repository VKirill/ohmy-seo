import { z } from "zod";
import { SCOPE_GTM_EDIT } from "@ohmy-seo/mcp-core/google-oauth";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import {
  assertConfirm,
  buildDryRunPreview,
  confirmField,
} from "../lib/confirm-gate.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_create_workspace";

export const gtmCreateWorkspaceInputSchema = z.object({
  account: z.string().optional().describe(
    "Label of a registered Google account (optional; uses default if omitted)."
  ),
  accountId: z.string().describe("GTM Account ID (numeric string)."),
  containerId: z.string().describe("GTM Container ID (numeric string)."),
  name: z.string().describe("Workspace name."),
  description: z.string().optional().describe("Workspace description (optional)."),
  confirm: confirmField,
});

export type GtmCreateWorkspaceInput = z.infer<typeof gtmCreateWorkspaceInputSchema>;

export const schema = {
  name: TOOL_NAME,
  description:
    "WRITE — creates a GTM Workspace in the given Container. Requires confirm:true.",
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description:
          "Label of a registered Google account (optional; uses default if omitted).",
      },
      accountId: { type: "string", description: "GTM Account ID (numeric string)." },
      containerId: { type: "string", description: "GTM Container ID (numeric string)." },
      name: { type: "string", description: "Workspace name." },
      description: { type: "string", description: "Workspace description (optional)." },
      confirm: {
        type: "boolean",
        default: false,
        description: "Set to true to execute. False returns dry-run preview.",
      },
    },
    required: ["accountId", "containerId", "name"],
  },
};

export async function runGtmCreateWorkspace(args: GtmCreateWorkspaceInput) {
  try {
    assertConfirm(args);

    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_EDIT, args.account);
    const path = `accounts/${args.accountId}/containers/${args.containerId}/workspaces`;

    const body: Record<string, unknown> = { name: args.name };
    if (args.description !== undefined) body.description = args.description;

    return executeGtmCall({
      account,
      scope: SCOPE_GTM_EDIT,
      method: "POST",
      path,
      body,
    });
  } catch (e) {
    // Dry-run path: confirm was false
    if ((e as Error).name === "ConfirmRequiredError") {
      const preview = buildDryRunPreview(
        "create_workspace",
        { accountId: args.accountId, containerId: args.containerId },
        { name: args.name, description: args.description }
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }],
      };
    }
    return errorToMcpContent(e);
  }
}
