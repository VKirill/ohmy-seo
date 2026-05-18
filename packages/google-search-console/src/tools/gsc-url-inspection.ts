import { SCOPE_GSC_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGscCall } from "../lib/gsc-client.js";

const PKG_NAME = "google-search-console";
const TOOL_NAME = "gsc_url_inspection";

registerCacheableTool(TOOL_NAME, {
  ttlEnvKey: "MCP_GSC_CACHE_TTL_INSPECT",
  ttlDefaultSeconds: 3600,
});

export const schema = {
  name: TOOL_NAME,
  description: "Inspects a URL against the Google Search Console index for the given site property.",
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description: "Label of a registered Google account (optional; uses default if omitted).",
      },
      siteUrl: {
        type: "string",
        description: "The site property URL (e.g. https://example.com/ or sc-domain:example.com).",
      },
      inspectionUrl: {
        type: "string",
        description: "The URL to inspect (must be under siteUrl).",
      },
      languageCode: {
        type: "string",
        description: "BCP-47 language code for the inspection result (optional; e.g. 'en-US').",
      },
    },
    required: ["siteUrl", "inspectionUrl"],
  },
};

export async function runGscUrlInspection(args: {
  account?: string;
  siteUrl: string;
  inspectionUrl: string;
  languageCode?: string;
}) {
  const account = await resolveAccount(PKG_NAME, SCOPE_GSC_READONLY, args.account);

  return withCache<unknown>(
    {
      toolName: TOOL_NAME,
      accountId: account.id,
      args: {
        account: args.account ?? null,
        siteUrl: args.siteUrl,
        inspectionUrl: args.inspectionUrl,
        languageCode: args.languageCode ?? null,
      },
      forceRefresh: false,
      packageName: PKG_NAME,
    },
    async () => {
      const body: Record<string, string> = {
        inspectionUrl: args.inspectionUrl,
        siteUrl: args.siteUrl,
      };
      if (args.languageCode) {
        body.languageCode = args.languageCode;
      }

      const result = await executeGscCall({
        account,
        scope: SCOPE_GSC_READONLY,
        method: "POST",
        path: "/v1/urlInspection/index:inspect",
        body,
      });

      return result.data;
    }
  );
}
