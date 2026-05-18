import { registerApp } from "../lib/db/oauth-apps-repo.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

export async function runRegisterOauthApp(input: {
  label: string;
  client_id: string;
  client_secret: string;
  scopes_declared: string;
}) {
  try {
    const app = registerApp(input);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(
          { registered: app, hint: "Now run start_oauth_flow with this app_label" },
          null,
          2,
        ),
      }],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
