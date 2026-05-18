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
const TOOL_NAME = "gtm_create_trigger";

export const gtmCreateTriggerInputSchema = z.object({
  account: z.string().optional().describe(
    "Label of a registered Google account (optional; uses default if omitted)."
  ),
  accountId: z.string().describe("GTM Account ID (numeric string)."),
  containerId: z.string().describe("GTM Container ID (numeric string)."),
  workspaceId: z.string().describe("GTM Workspace ID (numeric string)."),
  name: z.string().describe("Trigger name."),
  type: z
    .string()
    .describe(
      "Trigger type, e.g. 'pageview', 'click', 'customEvent', 'formSubmission'."
    ),
  filter: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("Trigger filter conditions (list of condition objects)."),
  customEventFilter: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("Custom event filter conditions (for customEvent triggers)."),
  parameter: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("Additional trigger parameters."),
  confirm: confirmField,
});

export type GtmCreateTriggerInput = z.infer<typeof gtmCreateTriggerInputSchema>;

export const schema = {
  name: TOOL_NAME,
  description:
    "WRITE — creates a GTM Trigger in the given Workspace. Requires confirm:true.",
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
      name: { type: "string", description: "Trigger name." },
      type: {
        type: "string",
        description:
          "Trigger type, e.g. 'pageview', 'click', 'customEvent', 'formSubmission'.",
      },
      filter: {
        type: "array",
        description: "Trigger filter conditions (list of condition objects).",
        items: { type: "object" },
      },
      customEventFilter: {
        type: "array",
        description: "Custom event filter conditions (for customEvent triggers).",
        items: { type: "object" },
      },
      parameter: {
        type: "array",
        description: "Additional trigger parameters.",
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

export async function runGtmCreateTrigger(args: GtmCreateTriggerInput) {
  try {
    assertConfirm(args);

    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_EDIT, args.account);
    const path = `accounts/${args.accountId}/containers/${args.containerId}/workspaces/${args.workspaceId}/triggers`;

    const body: Record<string, unknown> = { name: args.name, type: args.type };
    if (args.filter !== undefined) body.filter = args.filter;
    if (args.customEventFilter !== undefined) body.customEventFilter = args.customEventFilter;
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
        "create_trigger",
        {
          accountId: args.accountId,
          containerId: args.containerId,
          workspaceId: args.workspaceId,
        },
        { name: args.name, type: args.type, filter: args.filter }
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }],
      };
    }
    return errorToMcpContent(e);
  }
}
