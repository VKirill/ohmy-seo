import { insertOAuthApp } from "../lib/db/oauth-apps-repo.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const PKG_NAME = "google-search-console";

export async function runRegisterGoogleOauthApp(input: {
  label: string;
  client_id: string;
  client_secret: string;
  scopes_declared: string;
  redirect_uri: string;
}) {
  try {
    if (input.redirect_uri === "urn:ietf:wg:oauth:2.0:oob") {
      return {
        isError: true as const,
        content: [{
          type: "text" as const,
          text: "OOB redirect_uri is not supported. Google deprecated OOB OAuth on 2023-01-31. " +
            "Use a loopback redirect URI (http://127.0.0.1:PORT/oauth/callback) instead.",
        }],
      };
    }

    const app = insertOAuthApp(PKG_NAME, {
      label: input.label,
      client_id: input.client_id,
      client_secret_plain: input.client_secret,
      scopes_declared: input.scopes_declared,
      redirect_uri: input.redirect_uri,
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(
          { id: app.id, label: app.label, message: "App registered. Use start_google_oauth_flow next." },
          null,
          2,
        ),
      }],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
