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
const TOOL_NAME = "gtm_create_tag";

const parameterSchema = z.object({
  type: z.string().describe("Parameter type, e.g. 'template', 'boolean', 'list'."),
  key: z.string().optional().describe("Named key for the parameter."),
  value: z.string().optional().describe("String value for simple parameters."),
  list: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("List items for list-type parameters."),
  map: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("Map items for map-type parameters."),
});

export const gtmCreateTagInputSchema = z.object({
  account: z.string().optional().describe(
    "Label of a registered Google account (optional; uses default if omitted)."
  ),
  accountId: z.string().describe("GTM Account ID (numeric string)."),
  containerId: z.string().describe("GTM Container ID (numeric string)."),
  workspaceId: z.string().describe("GTM Workspace ID (numeric string)."),
  name: z.string().describe("Tag name."),
  type: z.string().describe("Tag type, e.g. 'ua', 'html', 'gclidAdw'."),
  parameter: z
    .array(parameterSchema)
    .optional()
    .describe("Tag configuration parameters."),
  firingTriggerIds: z
    .array(z.string())
    .optional()
    .describe("IDs of triggers that fire this tag."),
  blockingTriggerIds: z
    .array(z.string())
    .optional()
    .describe("IDs of triggers that block this tag."),
  tagFiringOption: z
    .string()
    .optional()
    .describe("Tag firing option, e.g. 'oncePerLoad', 'unlimited'."),
  confirm: confirmField,
});

export type GtmCreateTagInput = z.infer<typeof gtmCreateTagInputSchema>;

export const schema = {
  name: TOOL_NAME,
  description:
    "WRITE — creates a GTM Tag in the given Workspace. Requires confirm:true.",
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
      name: { type: "string", description: "Tag name." },
      type: { type: "string", description: "Tag type, e.g. 'ua', 'html', 'gclidAdw'." },
      parameter: {
        type: "array",
        description: "Tag configuration parameters.",
        items: { type: "object" },
      },
      firingTriggerIds: {
        type: "array",
        description: "IDs of triggers that fire this tag.",
        items: { type: "string" },
      },
      blockingTriggerIds: {
        type: "array",
        description: "IDs of triggers that block this tag.",
        items: { type: "string" },
      },
      tagFiringOption: {
        type: "string",
        description: "Tag firing option, e.g. 'oncePerLoad', 'unlimited'.",
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

export async function runGtmCreateTag(args: GtmCreateTagInput) {
  try {
    assertConfirm(args);

    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_EDIT, args.account);
    const path = `accounts/${args.accountId}/containers/${args.containerId}/workspaces/${args.workspaceId}/tags`;

    const body: Record<string, unknown> = { name: args.name, type: args.type };
    if (args.parameter !== undefined) body.parameter = args.parameter;
    if (args.firingTriggerIds !== undefined) body.firingTriggerIds = args.firingTriggerIds;
    if (args.blockingTriggerIds !== undefined) body.blockingTriggerIds = args.blockingTriggerIds;
    if (args.tagFiringOption !== undefined) body.tagFiringOption = args.tagFiringOption;

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
        "create_tag",
        {
          accountId: args.accountId,
          containerId: args.containerId,
          workspaceId: args.workspaceId,
        },
        { name: args.name, type: args.type, parameter: args.parameter, firingTriggerIds: args.firingTriggerIds }
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }],
      };
    }
    return errorToMcpContent(e);
  }
}
