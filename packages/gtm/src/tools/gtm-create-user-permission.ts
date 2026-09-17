// POST /accounts/{aid}/user_permissions
// Docs: https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.user_permissions/create
// Required scope: tagmanager.manage.users
// confirm:false → dry-run preview (no API call); confirm:true → executes POST

import { z } from "zod";
import { SCOPE_GTM_MANAGE_USERS } from "@ohmy-seo/mcp-core/google-oauth";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import {
  assertConfirm,
  buildDryRunPreview,
  confirmField,
} from "../lib/confirm-gate.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_create_user_permission";

const containerAccessSchema = z.object({
  containerId: z.string().describe("GTM Container ID."),
  permission: z
    .enum(["noAccess", "read", "edit", "approve", "publish"])
    .describe("Container-level permission."),
});

export const gtmCreateUserPermissionInputSchema = z.object({
  account: z.string().optional().describe(
    "Label of a registered Google account (optional; uses default if omitted)."
  ),
  accountId: z.string().describe("GTM Account ID (numeric string)."),
  emailAddress: z.string().describe("Email address of the user to grant access to."),
  accountPermission: z
    .enum(["noAccess", "user", "admin"])
    .describe("Account-level permission for the user."),
  containerAccess: z
    .array(containerAccessSchema)
    .optional()
    .describe("Per-container permissions to grant (optional)."),
  confirm: confirmField,
});

export type GtmCreateUserPermissionInput = z.infer<typeof gtmCreateUserPermissionInputSchema>;

export const schema = {
  name: TOOL_NAME,
  description:
    "WRITE — grants a user Account and/or Container access on a GTM account. Requires confirm:true.",
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
      emailAddress: { type: "string", description: "Email address of the user to grant access to." },
      accountPermission: {
        type: "string",
        enum: ["noAccess", "user", "admin"],
        description: "Account-level permission for the user.",
      },
      containerAccess: {
        type: "array",
        description: "Per-container permissions to grant (optional).",
        items: {
          type: "object",
          properties: {
            containerId: { type: "string" },
            permission: { type: "string", enum: ["noAccess", "read", "edit", "approve", "publish"] },
          },
        },
      },
      confirm: {
        type: "boolean",
        default: false,
        description: "Set to true to execute. False returns dry-run preview.",
      },
    },
    required: ["accountId", "emailAddress", "accountPermission"],
  },
};

export async function runGtmCreateUserPermission(args: GtmCreateUserPermissionInput) {
  try {
    assertConfirm(args);

    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_MANAGE_USERS, args.account);
    const path = `accounts/${args.accountId}/user_permissions`;

    const body: Record<string, unknown> = {
      emailAddress: args.emailAddress,
      accountAccess: { permission: args.accountPermission },
    };
    if (args.containerAccess !== undefined) body.containerAccess = args.containerAccess;

    const result = await executeGtmCall({
      account,
      scope: SCOPE_GTM_MANAGE_USERS,
      method: "POST",
      path,
      body,
    });

    return { content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }] };
  } catch (e) {
    if ((e as Error).name === "ConfirmRequiredError") {
      const preview = buildDryRunPreview(
        "create_user_permission",
        { accountId: args.accountId },
        {
          emailAddress: args.emailAddress,
          accountAccess: { permission: args.accountPermission },
          containerAccess: args.containerAccess,
        }
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }],
      };
    }
    return errorToMcpContent(e);
  }
}
