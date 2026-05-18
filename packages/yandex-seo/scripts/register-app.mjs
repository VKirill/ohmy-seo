#!/usr/bin/env node
/**
 * Register a Yandex OAuth app in the local SQLite state.
 *
 * Usage:
 *   APP_LABEL=seo \
 *   APP_CLIENT_ID=<client_id> \
 *   APP_CLIENT_SECRET=<client_secret> \
 *   APP_SCOPES="webmaster:hostinfo metrika:read" \
 *   ACCOUNT_LABEL=kirill \
 *   MCP_YANDEX_SEO_MASTER_KEY=<64 hex chars> \
 *   node scripts/register-app.mjs
 *
 * Idempotent: if an app with APP_LABEL already exists, prints the
 * authorize URL without re-registering.
 */

import { registerApp, getAppByLabel } from "../dist/lib/db/oauth-apps-repo.js";
import { buildAuthorizeUrl } from "../dist/lib/oauth/yandex-flow.js";

const label = process.env.APP_LABEL;
const clientId = process.env.APP_CLIENT_ID;
const clientSecret = process.env.APP_CLIENT_SECRET;
const scopes = process.env.APP_SCOPES;

if (!label || !clientId || !clientSecret || !scopes) {
  console.error(
    "Missing required env vars: APP_LABEL, APP_CLIENT_ID, APP_CLIENT_SECRET, APP_SCOPES"
  );
  process.exit(1);
}

if (!process.env.MCP_YANDEX_SEO_MASTER_KEY) {
  console.error("Missing required env var: MCP_YANDEX_SEO_MASTER_KEY");
  process.exit(1);
}

const existing = getAppByLabel(label);

let app;
if (existing) {
  console.error(`App "${label}" already registered (id=${existing.id}), skipping.`);
  app = existing;
} else {
  app = registerApp({
    label,
    client_id: clientId,
    client_secret: clientSecret,
    scopes_declared: scopes,
  });
  console.error(`App "${label}" registered (id=${app.id}).`);
}

const authorizeUrl = buildAuthorizeUrl({
  client_id: app.client_id,
  scopes_declared: app.scopes_declared,
});

console.log(authorizeUrl);
