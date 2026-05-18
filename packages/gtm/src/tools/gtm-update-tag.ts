// PUT /accounts/{aid}/containers/{cid}/workspaces/{wid}/tags/{tid}
// confirm:false → dry-run preview; confirm:true → PUT with requireEtag:true
// MissingEtagError → clear user message

import { SCOPE_GTM_EDIT } from "@ohmy-seo/mcp-core/google-oauth";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall, MissingEtagError } from "../lib/gtm-client.js";
import { assertConfirm, buildDryRunPreview } from "../lib/confirm-gate.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_update_tag";

const MISSING_ETAG_MSG =
  "Run gtm_list_tags or gtm_get_tag first to obtain current etag (concurrent-edit safeguard)";

export const schema = {
  name: TOOL_NAME,
  description:
    "WRITE — updates a GTM Tag via PUT. Requires a cached etag (run gtm_list_tags first). " +
    "confirm:false returns dry-run preview; confirm:true executes the update.",
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: "object" as const,
    properties: {
      account: { type: "string", description: "Registered Google account label (optional)." },
      accountId: { type: "string", description: "GTM Account ID." },
      containerId: { type: "string", description: "GTM Container ID." },
      workspaceId: { type: "string", description: "GTM Workspace ID." },
      tagId: { type: "string", description: "GTM Tag ID to update." },
      name: { type: "string", description: "Tag display name." },
      type: { type: "string", description: "Tag type (e.g. 'ua', 'gaawe')." },
      parameter: { type: "array", description: "Tag parameters.", items: { type: "object" } },
      firingTriggerId: { type: "array", description: "Firing trigger IDs.", items: { type: "string" } },
      blockingTriggerId: { type: "array", description: "Blocking trigger IDs.", items: { type: "string" } },
      tagFiringOption: { type: "string", description: "Tag firing option (e.g. 'oncePerEvent')." },
      notes: { type: "string", description: "Optional notes." },
      confirm: { type: "boolean", default: false, description: "true = execute; false = dry-run preview." },
    },
    required: ["accountId", "containerId", "workspaceId", "tagId"],
  },
};

export async function runGtmUpdateTag(args: {
  account?: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
  tagId: string;
  name?: string;
  type?: string;
  parameter?: unknown[];
  firingTriggerId?: string[];
  blockingTriggerId?: string[];
  tagFiringOption?: string;
  notes?: string;
  confirm?: boolean;
}) {
  try {
    const { account: accountLabel, accountId, containerId, workspaceId, tagId, confirm, ...tagSpec } = args;
    const path = `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/tags/${tagId}`;

    if (!confirm) {
      const preview = buildDryRunPreview("PUT tag", { accountId, containerId, workspaceId, tagId, path }, tagSpec);
      return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
    }

    assertConfirm({ confirm });

    const account = await resolveAccount(PKG_NAME, SCOPE_GTM_EDIT, accountLabel);

    const result = await executeGtmCall({ account, scope: SCOPE_GTM_EDIT, method: "PUT", path, body: tagSpec, requireEtag: true });
    return { content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }] };
  } catch (e) {
    if (e instanceof MissingEtagError) {
      return { isError: true as const, content: [{ type: "text" as const, text: MISSING_ETAG_MSG }] };
    }
    return errorToMcpContent(e);
  }
}
