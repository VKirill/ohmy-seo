import { listApps } from "../lib/db/oauth-apps-repo.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

export async function runListOauthApps() {
  try {
    const apps = listApps();
    return { content: [{ type: "text" as const, text: JSON.stringify({ apps }, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
