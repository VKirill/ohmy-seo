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
const TOOL_NAME = "gtm_create_variable";

export const gtmCreateVariableInputSchema = z.object({
  account: z.string().optional().describe(
    "Label of a registered Google account (optional; uses default if omitted)."
  ),
  accountId: z.string().describe("GTM Account ID (numeric string)."),
  containerId: z.string().describe("GTM Container ID (numeric string)."),
  workspaceId: z.string().describe("GTM Workspace ID (numeric string)."),
  name: z.string().describe("Variable name."),
  type: z
    .string()
    .describe(
      "Variable type, e.g. 'v' (constant), 'dlv' (dataLayer), 'k' (1st party cookie)."
    ),
  parameter: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("Variable configuration parameters."),
  confirm: confirmField,
});

export type GtmCreateVariableInput = z.infer<typeof gtmCreateVariableInputSchema>;

export const schema = {
  name: TOOL_NAME,
  description:
    "WRITE — creates a GTM Variable in the given Workspace. Requires confirm:true.",
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
      workspaceId: { type: "string", description: "GTM Workspace ID (numeric string)." },
      name: { type: "string", description: "Variable name." },
      type: {
        type: "string",
        description:
          "Variable type, e.g. 'v' (constant), 'dlv' (dataLayer), 'k' (1st party cookie).",
      },
      parameter: {
        type: "array",
        description: "Variable configuration parameters.",
        items: { type: "object" },
      },
      confirm: {
        type: "boolean",
        default: false,
        description: "Set to true to execute. False returns dry-run preview.",
      },
    },
    required: ["accountId", "containerId", "workspaceId", "name", "type"],
  },
};

export async function runGtmCreateVariable(args: GtmCreateVariableInput) {
  try {
    assertConfirm(args);

    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_EDIT, args.account);
    const path = `accounts/${args.accountId}/containers/${args.containerId}/workspaces/${args.workspaceId}/variables`;

    const body: Record<string, unknown> = { name: args.name, type: args.type };
    if (args.parameter !== undefined) body.parameter = args.parameter;

    return executeGtmCall({
      account,
      scope: SCOPE_GTM_EDIT,
      method: "POST",
      path,
      body,
    });
  } catch (e) {
    if ((e as Error).name === "ConfirmRequiredError") {
      const preview = buildDryRunPreview(
        "create_variable",
        {
          accountId: args.accountId,
          containerId: args.containerId,
          workspaceId: args.workspaceId,
        },
        { name: args.name, type: args.type, parameter: args.parameter }
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }],
      };
    }
    return errorToMcpContent(e);
  }
}
