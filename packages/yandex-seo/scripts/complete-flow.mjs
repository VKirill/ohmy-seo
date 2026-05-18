#!/usr/bin/env node
/**
 * One-shot: exchange Yandex authorization code → access+refresh tokens, save account.
 *
 * Usage (idempotent):
 *   MCP_YANDEX_SEO_MASTER_KEY=<hex> \
 *   APP_LABEL=seo ACCOUNT_LABEL=acc-1 CODE=<7+ chars> \
 *   node scripts/complete-flow.mjs
 *
 * If ACCOUNT_LABEL already exists — prints existing yandex_login and exits 0.
 */

import { getAppByLabel } from "../dist/lib/db/oauth-apps-repo.js";
import { insertAccount, getAccountByLabel } from "../dist/lib/db/accounts-repo.js";
import { exchangeCode } from "../dist/lib/oauth/yandex-flow.js";
import { probeLogin, probeWebmasterUserId } from "../dist/lib/oauth/login-probe.js";
import { hasScope, SCOPES } from "../dist/lib/scopes.js";

const appLabel = process.env.APP_LABEL;
const accountLabel = process.env.ACCOUNT_LABEL;
const code = process.env.CODE;

if (!appLabel || !accountLabel || !code) {
  console.error("Missing APP_LABEL / ACCOUNT_LABEL / CODE env vars");
  process.exit(1);
}

if (!process.env.MCP_YANDEX_SEO_MASTER_KEY) {
  console.error("Missing required env var: MCP_YANDEX_SEO_MASTER_KEY");
  process.exit(1);
}

// idempotent: if account already registered, return existing info
const existing = getAccountByLabel(accountLabel);
if (existing) {
  console.log(JSON.stringify({ status: "exists", account: { label: accountLabel, yandex_login: existing.yandex_login } }));
  process.exit(0);
}

const app = getAppByLabel(appLabel);
if (!app) {
  console.error(`App '${appLabel}' not found`);
  process.exit(1);
}

try {
  const tokens = await exchangeCode({ client_id: app.client_id, client_secret: app.client_secret }, code);
  const loginInfo = await probeLogin(tokens.access_token);
  const wmId = hasScope(tokens.scope || app.scopes_declared, SCOPES.WEBMASTER_HOSTINFO)
    ? await probeWebmasterUserId(tokens.access_token)
    : null;
  const now = Math.floor(Date.now() / 1000);
  const acc = insertAccount({
    label: accountLabel,
    oauth_app_id: app.id,
    yandex_login: loginInfo?.login ?? null,
    webmaster_user_id: wmId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: now + tokens.expires_in,
    scopes_granted: tokens.scope || app.scopes_declared,
  });
  console.log(JSON.stringify({
    status: "registered",
    account: {
      label: acc.label,
      yandex_login: acc.yandex_login,
      webmaster_user_id: acc.webmaster_user_id,
      scopes_granted: acc.scopes_granted,
    },
  }));
} catch (e) {
  console.error(`Exchange failed for ${accountLabel}: ${e.message}`);
  process.exit(2);
}
