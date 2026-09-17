// PUT /accounts/{aid}/user_permissions/{permissionId}
// Docs: https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.user_permissions/update
// Required scope: tagmanager.manage.users
//
// UserPermission has no `fingerprint` field in its resource representation (unlike tags/accounts),
// so there is no optimistic-concurrency token to require here — confirm:true executes a plain PUT.
// confirm:false → dry-run preview (no API call).

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
const TOOL_NAME = "gtm_update_user_permission";

const containerAccessSchema = z.object({
  containerId: z.string().describe("GTM Container ID."),
  permission: z
    .enum(["noAccess", "read", "edit", "approve", "publish"])
    .describe("Container-level permission."),
});

export const gtmUpdateUserPermissionInputSchema = z.object({
  account: z.string().optional().describe(
    "Label of a registered Google account (optional; uses default if omitted)."
  ),
  accountId: z.string().describe("GTM Account ID (numeric string)."),
  permissionId: z.string().describe("UserPermission ID to update (from gtm_list_user_permissions)."),
  emailAddress: z.string().optional().describe("Email address of the user (usually unchanged)."),
  accountPermission: z
    .enum(["noAccess", "user", "admin"])
    .optional()
    .describe("Account-level permission for the user."),
  containerAccess: z
    .array(containerAccessSchema)
    .optional()
    .describe("Per-container permissions (replaces the existing set when provided)."),
  confirm: confirmField,
});

export type GtmUpdateUserPermissionInput = z.infer<typeof gtmUpdateUserPermissionInputSchema>;

export const schema = {
  name: TOOL_NAME,
  description:
    "WRITE — updates a user's Account/Container access on a GTM account via PUT. " +
    "Requires permissionId (from gtm_list_user_permissions). confirm:false returns dry-run preview; " +
    "confirm:true executes the update.",
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: "object" as const,
    properties: {
      account: { type: "string", description: "Registered Google account label (optional)." },
      accountId: { type: "string", description: "GTM Account ID (numeric string)." },
      permissionId: { type: "string", description: "UserPermission ID to update." },
      emailAddress: { type: "string", description: "Email address of the user (usually unchanged)." },
      accountPermission: {
        type: "string",
        enum: ["noAccess", "user", "admin"],
        description: "Account-level permission for the user.",
      },
      containerAccess: {
        type: "array",
        description: "Per-container permissions (replaces the existing set when provided).",
        items: {
          type: "object",
          properties: {
            containerId: { type: "string" },
            permission: { type: "string", enum: ["noAccess", "read", "edit", "approve", "publish"] },
          },
        },
      },
      confirm: { type: "boolean", default: false, description: "true = execute; false = dry-run preview." },
    },
    required: ["accountId", "permissionId"],
  },
};

export async function runGtmUpdateUserPermission(args: GtmUpdateUserPermissionInput) {
  try {
    const { account: accountLabel, accountId, permissionId, emailAddress, accountPermission, containerAccess, confirm } = args;
    const path = `accounts/${accountId}/user_permissions/${permissionId}`;

    const body: Record<string, unknown> = {};
    if (emailAddress !== undefined) body.emailAddress = emailAddress;
    if (accountPermission !== undefined) body.accountAccess = { permission: accountPermission };
    if (containerAccess !== undefined) body.containerAccess = containerAccess;

    if (!confirm) {
      const preview = buildDryRunPreview("PUT user_permission", { accountId, permissionId, path }, body);
      return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
    }

    assertConfirm({ confirm });

    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_MANAGE_USERS, accountLabel);

    const result = await executeGtmCall({
      account,
      scope: SCOPE_GTM_MANAGE_USERS,
      method: "PUT",
      path,
      body,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
