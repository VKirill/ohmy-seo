// GET /accounts/{aid}/user_permissions
// Docs: https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.user_permissions/list
// Required scope: tagmanager.manage.users
//
// READ tool but NOT registered as cacheable: user/permission grants can change out-of-band
// (another admin revoking/granting access) and staleness here has real access-control consequences,
// unlike tag/trigger/variable metadata. Always hits the API live.

import { SCOPE_GTM_MANAGE_USERS } from "@ohmy-seo/mcp-core/google-oauth";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_list_user_permissions";

export const schema = {
  name: TOOL_NAME,
  description:
    "Lists all users with access to a GTM account and their account/container permissions. " +
    "Not cached — permission grants change out-of-band and staleness has access-control consequences.",
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description: "Label of a registered Google account (optional; uses default if omitted).",
      },
      accountId: { type: "string", description: "GTM Account ID (numeric string)." },
    },
    required: ["accountId"],
  },
};

export async function runGtmListUserPermissions(args: { account?: string; accountId: string }) {
  try {
    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_MANAGE_USERS, args.account);

    const result = await executeGtmCall({
      account,
      scope: SCOPE_GTM_MANAGE_USERS,
      method: "GET",
      path: `accounts/${args.accountId}/user_permissions`,
    });

    const userPermission: unknown[] =
      (result.data as Record<string, unknown>)?.userPermission as unknown[] ?? [];

    return { content: [{ type: "text" as const, text: JSON.stringify({ userPermission }, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
