import { getAppByLabel } from "../lib/db/oauth-apps-repo.js";
import { getAccountByLabel, insertAccount } from "../lib/db/accounts-repo.js";
import { exchangeCode } from "../lib/oauth/yandex-flow.js";
import { probeLogin, probeWebmasterUserId } from "../lib/oauth/login-probe.js";
import { hasScope, SCOPES } from "../lib/scopes.js";
import { errorToMcpContent } from "../lib/errors.js";

export async function runCompleteOauthFlow(input: {
  app_label: string;
  account_label: string;
  code: string;
}) {
  try {
    const app = getAppByLabel(input.app_label);
    if (!app) {
      throw new Error(`OAuth app '${input.app_label}' not found`);
    }
    const existing = getAccountByLabel(input.account_label);
    if (existing) {
      throw new Error(`Account '${input.account_label}' already exists`);
    }

    const tokens = await exchangeCode(
      { client_id: app.client_id, client_secret: app.client_secret },
      input.code,
    );

    const loginInfo = await probeLogin(tokens.access_token);
    const webmasterUserId = hasScope(tokens.scope || app.scopes_declared, SCOPES.WEBMASTER_HOSTINFO)
      ? await probeWebmasterUserId(tokens.access_token)
      : null;

    const now = Math.floor(Date.now() / 1000);
    const acc = insertAccount({
      label: input.account_label,
      oauth_app_id: app.id,
      yandex_login: loginInfo?.login ?? null,
      webmaster_user_id: webmasterUserId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: now + tokens.expires_in,
      scopes_granted: tokens.scope || app.scopes_declared,
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(
          {
            connected: acc,
            yandex_login: loginInfo?.login,
            webmaster_user_id: webmasterUserId,
            hint: "Account is ready. Try a domain tool with account: '" + acc.label + "'.",
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
