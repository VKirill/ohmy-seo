// POST /accounts/{aid}/containers
// Docs: https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers/create
// Required scope: tagmanager.edit.containers
// confirm:false → dry-run preview (no API call); confirm:true → executes POST

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
const TOOL_NAME = "gtm_create_container";

export const gtmCreateContainerInputSchema = z.object({
  account: z.string().optional().describe(
    "Label of a registered Google account (optional; uses default if omitted)."
  ),
  accountId: z.string().describe("GTM Account ID (numeric string)."),
  name: z.string().describe("Container display name."),
  usageContext: z
    .array(z.string())
    .describe("Usage contexts, e.g. ['web'], ['android'], ['ios'], ['androidSdk5'], ['iosSdk5']."),
  domainName: z
    .array(z.string())
    .optional()
    .describe("Domain names associated with the container (optional)."),
  notes: z.string().optional().describe("Container notes (optional)."),
  confirm: confirmField,
});

export type GtmCreateContainerInput = z.infer<typeof gtmCreateContainerInputSchema>;

export const schema = {
  name: TOOL_NAME,
  description:
    "WRITE — creates a GTM Container in the given Account. Requires confirm:true.",
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
      name: { type: "string", description: "Container display name." },
      usageContext: {
        type: "array",
        description: "Usage contexts, e.g. ['web'], ['android'], ['ios'].",
        items: { type: "string" },
      },
      domainName: {
        type: "array",
        description: "Domain names associated with the container (optional).",
        items: { type: "string" },
      },
      notes: { type: "string", description: "Container notes (optional)." },
      confirm: {
        type: "boolean",
        default: false,
        description: "Set to true to execute. False returns dry-run preview.",
      },
    },
    required: ["accountId", "name", "usageContext"],
  },
};

export async function runGtmCreateContainer(args: GtmCreateContainerInput) {
  try {
    assertConfirm(args);

    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_EDIT, args.account);
    const path = `accounts/${args.accountId}/containers`;

    const body: Record<string, unknown> = {
      name: args.name,
      usageContext: args.usageContext,
    };
    if (args.domainName !== undefined) body.domainName = args.domainName;
    if (args.notes !== undefined) body.notes = args.notes;

    const result = await executeGtmCall({
      account,
      scope: SCOPE_GTM_EDIT,
      method: "POST",
      path,
      body,
    });

    return { content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }] };
  } catch (e) {
    if ((e as Error).name === "ConfirmRequiredError") {
      const preview = buildDryRunPreview(
        "create_container",
        { accountId: args.accountId },
        { name: args.name, usageContext: args.usageContext, domainName: args.domainName, notes: args.notes }
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }],
      };
    }
    return errorToMcpContent(e);
  }
}
