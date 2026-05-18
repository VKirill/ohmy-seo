import { getAppByLabel } from "../lib/db/oauth-apps-repo.js";
import { getAccountByLabel } from "../lib/db/accounts-repo.js";
import { buildAuthorizeUrl } from "../lib/oauth/yandex-flow.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

export async function runStartOauthFlow(input: {
  app_label: string;
  account_label: string;
}) {
  try {
    const app = getAppByLabel(input.app_label);
    if (!app) {
      throw new Error(`OAuth app '${input.app_label}' not found. Run list_oauth_apps.`);
    }
    const existing = getAccountByLabel(input.account_label);
    if (existing) {
      throw new Error(
        `Account label '${input.account_label}' is already taken. Pick another or delete_account first.`,
      );
    }
    const url = buildAuthorizeUrl(app);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(
          {
            authorize_url: url,
            account_label: input.account_label,
            next:
              "Open authorize_url in a browser, approve, copy the 7-character code from Yandex page, " +
              "then call complete_oauth_flow with the same account_label.",
          },
          null,
          2,
        ),
      }],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
