import crypto from "node:crypto";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  LoopbackListener,
} from "@ohmy-seo/mcp-core/google-oauth";
import { findOAuthAppByLabel } from "../lib/db/oauth-apps-repo.js";
import { findAccountByLabel, insertAccount } from "../lib/db/accounts-repo.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const PKG_NAME = "gtm";

export async function runStartGoogleOauthFlow(input: {
  app_label: string;
  account_label: string;
  login_hint?: string;
}) {
  try {
    const app = findOAuthAppByLabel(PKG_NAME, input.app_label);
    if (!app) {
      throw new Error(`OAuth app '${input.app_label}' not found. Run list_google_oauth_apps.`);
    }
    const existing = findAccountByLabel(PKG_NAME, input.account_label);
    if (existing) {
      throw new Error(
        `Account label '${input.account_label}' already taken. Pick another or delete_google_account first.`
      );
    }

    const state = crypto.randomBytes(32).toString("base64url");
    const portEnv = process.env["MCP_GTM_OAUTH_LOOPBACK_PORT"];
    const preferredPort = portEnv ? parseInt(portEnv, 10) : 8767;

    const listener = new LoopbackListener({ preferredPort });
    const { callbackUrl } = await listener.start();

    const authUrl = buildAuthorizeUrl({
      client_id: app.client_id,
      redirect_uri: callbackUrl,
      scopes: app.scopes_declared.split(/\s+/).filter(Boolean),
      state,
      login_hint: input.login_hint,
    });

    console.error(`[google-oauth] Open this URL in your browser (you have 5 minutes):\n${authUrl}`);

    const result = await listener.waitForCode(state, 300_000);

    if ("error" in result) {
      if (result.error === "timeout") {
        throw new Error(
          "OAuth flow timed out (5 min). Run start_google_oauth_flow again and open the URL promptly."
        );
      }
      throw new Error(`OAuth error from Google: ${result.error}`);
    }

    const tokens = await exchangeCodeForTokens({
      client_id: app.client_id,
      client_secret: app.client_secret,
      code: result.code,
      redirect_uri: callbackUrl,
    });

    const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userinfo = userinfoRes.ok
      ? (await userinfoRes.json() as { email?: string })
      : { email: null };

    const now = Math.floor(Date.now() / 1000);
    const account = insertAccount(PKG_NAME, {
      label: input.account_label,
      auth_method: "oauth_user",
      oauth_app_id: app.id,
      google_email: userinfo.email ?? null,
      access_token_plain: tokens.access_token,
      refresh_token_plain: tokens.refresh_token ?? null,
      expires_at: now + tokens.expires_in,
      scopes_granted: tokens.scope || app.scopes_declared,
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(
          {
            account_label: account.label,
            google_email: account.google_email,
            scopes_granted: account.scopes_granted,
            hint: `Account ready. Use account: '${account.label}' in other tools.`,
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
