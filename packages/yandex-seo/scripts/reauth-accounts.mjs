#!/usr/bin/env node
/**
 * Batch re-authorization: exchange 4 Yandex auth codes → fresh tokens, replace DB entries.
 *
 * Usage:
 *   CODE_1=<code> CODE_2=<code> CODE_3=<code> CODE_4=<code> \
 *   APP_LABEL=seo \
 *   node scripts/reauth-accounts.mjs
 *
 * Safe order:
 *   PHASE 1 — exchange all codes in memory (no DB writes)
 *   PHASE 2 — for each success: delete old account, insert new one
 *   PHASE 3 — set default to acc-1 (or first successful)
 *   PHASE 4 — verify diagnostics endpoint (expects ok=true or 404, NOT 403)
 */

import { getAppByLabel } from "../dist/lib/db/oauth-apps-repo.js";
import { insertAccount, deleteAccount, setDefault } from "../dist/lib/db/accounts-repo.js";
import { exchangeCode } from "../dist/lib/oauth/yandex-flow.js";
import { probeLogin, probeWebmasterUserId } from "../dist/lib/oauth/login-probe.js";
import { fetch } from "undici";

if (!process.env.MCP_YANDEX_SEO_MASTER_KEY) {
  console.error("Missing required env var: MCP_YANDEX_SEO_MASTER_KEY");
  process.exit(1);
}

const appLabel = process.env.APP_LABEL || "seo";
const DIAGNOSTICS_HOST = "https%3Atreba-online.ru%3A443";
const WM_API_BASE = "https://api.webmaster.yandex.net";

const accounts = [
  { label: "acc-1", code: process.env.CODE_1 },
  { label: "acc-2", code: process.env.CODE_2 },
  { label: "acc-3", code: process.env.CODE_3 },
  { label: "acc-4", code: process.env.CODE_4 },
].filter((a) => a.code);

if (accounts.length === 0) {
  console.error("No codes provided. Set CODE_1..CODE_4 env vars.");
  process.exit(1);
}

const app = getAppByLabel(appLabel);
if (!app) {
  console.error(`OAuth app '${appLabel}' not found in DB`);
  process.exit(1);
}

// PHASE 1 — exchange all codes in memory
const exchanged = [];
for (const { label, code } of accounts) {
  try {
    const tokens = await exchangeCode({ client_id: app.client_id, client_secret: app.client_secret }, code);
    const loginInfo = await probeLogin(tokens.access_token);
    const wmId = await probeWebmasterUserId(tokens.access_token);
    exchanged.push({ label, tokens, loginInfo, wmId, status: "ok" });
    console.error(`[phase1] ${label}: exchange ok, login=${loginInfo?.login}`);
  } catch (e) {
    exchanged.push({ label, error: e.message, status: "failed" });
    console.error(`[phase1] ${label}: exchange FAILED — ${e.message}`);
  }
}

// PHASE 2 — delete old + insert new (only for successful exchanges)
const reauthResults = [];
const renewedAccounts = [];
for (const entry of exchanged) {
  if (entry.status === "failed") {
    reauthResults.push({ label: entry.label, status: "failed", error: entry.error });
    continue;
  }
  try {
    const { label, tokens, loginInfo, wmId } = entry;
    const now = Math.floor(Date.now() / 1000);
    deleteAccount(label);
    const acc = insertAccount({
      label,
      oauth_app_id: app.id,
      yandex_login: loginInfo?.login ?? null,
      webmaster_user_id: wmId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: now + tokens.expires_in,
      scopes_granted: tokens.scope || app.scopes_declared,
    });
    reauthResults.push({
      label,
      status: "renewed",
      yandex_login: acc.yandex_login,
      scopes_granted: acc.scopes_granted,
    });
    renewedAccounts.push({ label, tokens, wmId });
    console.error(`[phase2] ${label}: renewed ok`);
  } catch (e) {
    reauthResults.push({ label: entry.label, status: "failed", error: e.message });
    console.error(`[phase2] ${entry.label}: insert FAILED — ${e.message}`);
  }
}

// PHASE 3 — set default
let defaultAccount = null;
const preferredDefault = ["acc-1", "acc-2", "acc-3", "acc-4"].find(
  (lbl) => renewedAccounts.some((a) => a.label === lbl)
);
if (preferredDefault) {
  try {
    setDefault(preferredDefault);
    defaultAccount = preferredDefault;
    console.error(`[phase3] default set to ${preferredDefault}`);
  } catch (e) {
    console.error(`[phase3] setDefault failed: ${e.message}`);
  }
}

// PHASE 4 — verify diagnostics endpoint
const verifyResults = [];
for (const { label, tokens, wmId } of renewedAccounts) {
  if (!wmId) {
    verifyResults.push({ label, diagnostics_call: "error", details: "no webmaster_user_id" });
    continue;
  }
  try {
    const url = `${WM_API_BASE}/v4/user/${wmId}/hosts/${DIAGNOSTICS_HOST}/diagnostics`;
    const resp = await fetch(url, {
      headers: { Authorization: "OAuth " + tokens.access_token },
    });
    const status = resp.status;
    if (status === 200) {
      verifyResults.push({ label, diagnostics_call: "ok", details: `HTTP 200` });
    } else if (status === 404) {
      verifyResults.push({ label, diagnostics_call: "ok", details: `HTTP 404 (site not in this account)` });
    } else if (status === 403) {
      verifyResults.push({ label, diagnostics_call: "error", details: `HTTP 403 — scope not granted` });
    } else {
      verifyResults.push({ label, diagnostics_call: "ok", details: `HTTP ${status}` });
    }
    console.error(`[phase4] ${label}: diagnostics HTTP ${status}`);
  } catch (e) {
    verifyResults.push({ label, diagnostics_call: "error", details: e.message });
    console.error(`[phase4] ${label}: diagnostics error — ${e.message}`);
  }
}

console.log(JSON.stringify({ reauth_results: reauthResults, verify_results: verifyResults, default_account: defaultAccount }, null, 2));
