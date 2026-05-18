import { findOAuthAppByLabel, deleteOAuthApp } from "../lib/db/oauth-apps-repo.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const PKG_NAME = "gtm";

export async function runDeleteGoogleOauthApp(input: { app_label: string }) {
  try {
    const app = findOAuthAppByLabel(PKG_NAME, input.app_label);
    if (!app) {
      return {
        isError: true as const,
        content: [{
          type: "text" as const,
          text: `OAuth app '${input.app_label}' not found. Run list_google_oauth_apps to see available apps.`,
        }],
      };
    }
    deleteOAuthApp(PKG_NAME, app.id);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ deleted: input.app_label }, null, 2),
      }],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Cannot delete: accounts attached")) {
      return {
        isError: true as const,
        content: [{
          type: "text" as const,
          text: `Cannot delete app '${input.app_label}': ${msg}. Delete the attached accounts first with delete_google_account.`,
        }],
      };
    }
    return errorToMcpContent(e);
  }
}
