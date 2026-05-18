import { listOAuthApps } from "../lib/db/oauth-apps-repo.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const PKG_NAME = "ga4";

export async function runListGoogleOauthApps() {
  try {
    const apps = listOAuthApps(PKG_NAME);
    return { content: [{ type: "text" as const, text: JSON.stringify({ apps }, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
