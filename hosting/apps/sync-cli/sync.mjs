#!/usr/bin/env node
/**
 * ohmy-seo local sync.
 *
 * Pulls every account connected at ohmy-seo.ru and writes the access tokens
 * into the SQLite databases a locally installed ohmy-seo reads. Refresh tokens
 * stay on the server, so this has to run again when tokens age out — put it in
 * cron/launchd every 30 minutes.
 *
 *   OHMY_SEO_API_KEY=ohmy_...  \
 *   OHMY_SEO_DATA_DIR=~/.ohmy-seo \
 *   node sync.mjs
 */
import Database from "better-sqlite3";
import { createCipheriv, randomBytes, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const API = process.env.OHMY_SEO_API_URL ?? "https://ohmy-seo.ru";
const KEY = process.env.OHMY_SEO_API_KEY;
const DATA_DIR = (process.env.OHMY_SEO_DATA_DIR ?? join(homedir(), ".ohmy-seo")).replace(/^~/, homedir());

if (!KEY) {
  console.error("OHMY_SEO_API_KEY is not set. Create a key at " + API + "/app");
  process.exit(1);
}

mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

// One local master key, generated once and reused, so the databases stay
// readable across runs. It never leaves this machine.
const keyFile = join(DATA_DIR, "master.key");
if (!existsSync(keyFile)) {
  writeFileSync(keyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  console.log("Generated local master key at " + keyFile);
}
const MASTER = Buffer.from(readFileSync(keyFile, "utf8").trim(), "hex");

function encrypt(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", MASTER, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]);
}

const res = await fetch(`${API}/api/v1/bundle`, { headers: { Authorization: `Bearer ${KEY}` } });
if (!res.ok) {
  console.error(`Bundle request failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const bundle = await res.json();

const SCHEMA = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const dbPath = join(DATA_DIR, "state.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(SCHEMA);

const now = Math.floor(Date.now() / 1000);
const placeholder = encrypt("server-managed");
const yandexApp = db.prepare(
  `INSERT INTO oauth_apps (label, client_id, client_secret_enc, scopes_declared, created_at)
   VALUES ('ohmy-seo','server-managed',?,'',?)
   ON CONFLICT(label) DO UPDATE SET created_at = excluded.created_at RETURNING id`,
).get(placeholder, now);
const googleApp = db.prepare(
  `INSERT INTO google_oauth_apps (label, client_id, client_secret_enc, scopes_declared, redirect_uri, created_at)
   VALUES ('ohmy-seo','server-managed',?,'','',?)
   ON CONFLICT(label) DO UPDATE SET created_at = excluded.created_at RETURNING id`,
).get(placeholder, now);

const upY = db.prepare(
  `INSERT INTO accounts (label, oauth_app_id, yandex_login, access_token_enc, refresh_token_enc,
                         expires_at, scopes_granted, is_default, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(label) DO UPDATE SET access_token_enc=excluded.access_token_enc,
     expires_at=excluded.expires_at, scopes_granted=excluded.scopes_granted, updated_at=excluded.updated_at`);
const upG = db.prepare(
  `INSERT INTO google_accounts (label, auth_method, oauth_app_id, google_email, access_token_enc,
                                refresh_token_enc, expires_at, scopes_granted, is_default, created_at, updated_at)
   VALUES (?,'oauth_user',?,?,?,?,?,?,?,?,?)
   ON CONFLICT(label) DO UPDATE SET access_token_enc=excluded.access_token_enc,
     expires_at=excluded.expires_at, scopes_granted=excluded.scopes_granted, updated_at=excluded.updated_at`);

let ok = 0;
let skipped = 0;
db.transaction(() => {
  for (const a of bundle.accounts) {
    if (!a.accessToken) {
      console.warn(`skip ${a.provider}/${a.label}: ${a.error}`);
      skipped++;
      continue;
    }
    const exp = Math.floor(new Date(a.expiresAt).getTime() / 1000);
    const enc = encrypt(a.accessToken);
    const scopes = a.scopes.join(" ");
    if (["yandex", "yandex-direct", "yandex-api"].includes(a.provider)) {
      const label = a.provider === "yandex-direct" ? `${a.label} (Директ)` : a.provider === "yandex-api" ? `${a.label} (API)` : a.label;
      upY.run(label, yandexApp.id, a.login, enc, placeholder, exp, scopes, a.isDefault ? 1 : 0, now, now);
    } else if (a.provider === "google") {
      upG.run(a.label, googleApp.id, a.email, enc, placeholder, exp, scopes, a.isDefault ? 1 : 0, now, now);
    }
    ok++;
  }
})();
db.close();

console.log(`Synced ${ok} account(s)${skipped ? `, skipped ${skipped}` : ""} into ${dbPath}`);
console.log(`\nPoint ohmy-seo at it:
  MCP_YANDEX_SEO_MASTER_KEY=${MASTER.toString("hex")}
  MCP_YANDEX_SEO_DB_PATH=${dbPath}
(the same value works for MCP_GSC_*, MCP_GA4_* and MCP_GTM_*)`);
