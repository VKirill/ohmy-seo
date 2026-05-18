import { SCOPE_INDEXING } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGscCall } from "../lib/gsc-client.js";

const PKG_NAME = "google-search-console";
const TOOL_NAME = "gsc_indexing_publish";

const DESCRIPTION = `Sends a URL notification to the Google Indexing API (POST /v3/urlNotifications:publish).

WARNING — READ BEFORE USE:
- Indexing API requires Service Account with OWNER role on the GSC property (Full user is NOT enough).
- Default quota: 200 calls/day/project (raiseable via quota form in Google Cloud Console).
- Works ONLY for JobPosting / BroadcastEvent / LivestreamEvent URLs. Calling this for regular pages (articles, products) violates Google policy and has no effect — repeated abuse may revoke API access.

On 403 error: verify the service account email is added as OWNER on the property in Search Console.`;

export const schema = {
  name: TOOL_NAME,
  description: DESCRIPTION,
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description: "Label of a registered Google account (optional; uses default if omitted).",
      },
      url: {
        type: "string",
        description: "Fully-qualified URL of the page to notify (must contain JobPosting or BroadcastEvent schema).",
      },
      type: {
        type: "string",
        enum: ["URL_UPDATED", "URL_DELETED"],
        description: "URL_UPDATED for new/changed pages; URL_DELETED for removed pages.",
      },
    },
    required: ["url", "type"],
  },
};

export async function runGscIndexingPublish(args: {
  account?: string;
  url: string;
  type: "URL_UPDATED" | "URL_DELETED";
}) {
  const account = await resolveAccount(PKG_NAME, SCOPE_INDEXING, args.account);

  const result = await executeGscCall({
    account,
    scope: SCOPE_INDEXING,
    method: "POST",
    baseUrl: "https://indexing.googleapis.com",
    path: "/v3/urlNotifications:publish",
    body: { url: args.url, type: args.type },
  });

  if (!result.ok) {
    if (result.status === 403) {
      return {
        success: false,
        status: 403,
        error: "403 from Indexing API: verify the service account email is added as OWNER on the property in Search Console.",
      };
    }
    return {
      success: false,
      status: result.status,
      error: result.data,
    };
  }

  const data = result.data as Record<string, unknown>;
  const metadata = data?.urlNotificationMetadata as Record<string, unknown> | undefined;
  const notifyTime = (metadata?.latestUpdate as Record<string, unknown> | undefined)?.notifyTime;

  return {
    success: true,
    message: `Indexing API notified for "${args.url}" (type: ${args.type}).`,
    notifyTime: notifyTime ?? null,
  };
}
