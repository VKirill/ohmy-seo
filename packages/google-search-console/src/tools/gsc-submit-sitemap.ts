import { SCOPE_GSC_FULL } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGscCall } from "../lib/gsc-client.js";

const PKG_NAME = "google-search-console";
const TOOL_NAME = "gsc_submit_sitemap";

export const schema = {
  name: TOOL_NAME,
  description: "Submits (or re-submits) a sitemap to Google Search Console via PUT request. Requires SCOPE_GSC_FULL.",
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description: "Label of a registered Google account (optional; uses default if omitted).",
      },
      siteUrl: {
        type: "string",
        description: "The site URL as registered in Search Console (e.g. https://example.com/).",
      },
      feedpath: {
        type: "string",
        description: "Full URL of the sitemap (e.g. https://example.com/sitemap.xml).",
      },
    },
    required: ["siteUrl", "feedpath"],
  },
};

export async function runGscSubmitSitemap(args: {
  account?: string;
  siteUrl: string;
  feedpath: string;
}) {
  const account = await resolveAccount(PKG_NAME, SCOPE_GSC_FULL, args.account);

  const encodedSite = encodeURIComponent(args.siteUrl);
  const encodedFeed = encodeURIComponent(args.feedpath);
  const path = `/webmasters/v3/sites/${encodedSite}/sitemaps/${encodedFeed}`;

  const result = await executeGscCall({
    account,
    scope: SCOPE_GSC_FULL,
    method: "PUT",
    path,
  });

  if (!result.ok) {
    return {
      success: false,
      status: result.status,
      error: result.data,
    };
  }

  return {
    success: true,
    message: `Sitemap "${args.feedpath}" submitted to property "${args.siteUrl}".`,
  };
}
