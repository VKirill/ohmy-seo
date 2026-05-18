/**
 * gtm-delete-tag: DELETE /accounts/{aid}/containers/{cid}/workspaces/{wid}/tags/{tid}
 *
 * confirm:false → dry-run preview (no API call)
 * confirm:true  → executes DELETE with If-Match header (requireEtag:true)
 *
 * If no cached etag → MissingEtagError → user-friendly message.
 */

import { SCOPE_GTM_EDIT } from "@ohmy-seo/mcp-core/google-oauth";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall, MissingEtagError } from "../lib/gtm-client.js";
import { assertConfirm, buildDryRunPreview } from "../lib/confirm-gate.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_delete_tag";

export const schema = {
  name: TOOL_NAME,
  description:
    "WRITE — deletes a GTM Tag. Requires a cached etag (run gtm_list_tags first). " +
    "confirm:false returns a dry-run preview; confirm:true executes the delete.",
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description: "Label of a registered Google account (optional; uses default if omitted).",
      },
      accountId: { type: "string", description: "GTM Account ID." },
      containerId: { type: "string", description: "GTM Container ID." },
      workspaceId: { type: "string", description: "GTM Workspace ID." },
      tagId: { type: "string", description: "GTM Tag ID to delete." },
      confirm: {
        type: "boolean",
        default: false,
        description: "Set to true to execute the delete. false returns a dry-run preview.",
      },
    },
    required: ["accountId", "containerId", "workspaceId", "tagId"],
  },
};

export async function runGtmDeleteTag(args: {
  account?: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
  tagId: string;
  confirm?: boolean;
}) {
  try {
    const { account: accountLabel, accountId, containerId, workspaceId, tagId, confirm } = args;

    const path = `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/tags/${tagId}`;

    if (!confirm) {
      const preview = buildDryRunPreview(
        "DELETE tag",
        { accountId, containerId, workspaceId, tagId, path },
        {}
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }],
      };
    }

    assertConfirm({ confirm });

    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_EDIT, accountLabel);

    const result = await executeGtmCall({
      account,
      scope: SCOPE_GTM_EDIT,
      method: "DELETE",
      path,
      requireEtag: true,
    });

    const responseText =
      result.status === 204
        ? JSON.stringify({ deleted: true, tagId, path }, null, 2)
        : JSON.stringify(result.data, null, 2);

    return {
      content: [{ type: "text" as const, text: responseText }],
    };
  } catch (e) {
    if (e instanceof MissingEtagError) {
      return {
        isError: true as const,
        content: [
          {
            type: "text" as const,
            text: "Run gtm_list_tags or gtm_get_tag first to obtain current etag (concurrent-edit safeguard)",
          },
        ],
      };
    }
    return errorToMcpContent(e);
  }
}
