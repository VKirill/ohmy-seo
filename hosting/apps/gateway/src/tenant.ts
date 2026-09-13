import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { encryptWith, decryptWith, platformKey, tenantKey, hashApiKey } from "./crypto.js";

export const TENANT_ROOT = process.env.TENANT_ROOT ?? "/data/tenants";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

export type Provider = "yandex" | "yandex-direct" | "google";

export type Account = {
  connectionId: number;
  provider: Provider;
  label: string;
  login: string | null;
  email: string | null;
  accessToken: string;
  expiresAt: Date;
  scopes: string;
  isDefault: boolean;
};

/** Live connections for a user with a currently-valid access token. */
export async function loadAccounts(userId: number): Promise<Account[]> {
  const r = await pool.query<{
    id: string; provider: Provider; label: string;
    account_login: string | null; account_email: string | null;
    access_token_enc: Buffer; expires_at: Date; scopes_granted: string;
    is_login_identity: boolean;
  }>(
    `SELECT id, provider, label, account_login, account_email,
            access_token_enc, expires_at, scopes_granted, is_login_identity
       FROM connections
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY created_at`,
    [userId],
  );
  const key = platformKey();
  return r.rows.map((x) => ({
    connectionId: Number(x.id),
    provider: x.provider,
    label: x.label,
    login: x.account_login,
    email: x.account_email,
    accessToken: decryptWith(key, x.access_token_enc),
    expiresAt: x.expires_at,
    scopes: x.scopes_granted,
    isDefault: x.is_login_identity,
  }));
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS oauth_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL, client_secret_enc BLOB NOT NULL,
  scopes_declared TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT UNIQUE NOT NULL,
  oauth_app_id INTEGER NOT NULL REFERENCES oauth_apps(id) ON DELETE RESTRICT,
  yandex_login TEXT, webmaster_user_id INTEGER,
  access_token_enc BLOB NOT NULL, refresh_token_enc BLOB NOT NULL,
  expires_at INTEGER NOT NULL, scopes_granted TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS google_oauth_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL, client_secret_enc BLOB NOT NULL,
  scopes_declared TEXT NOT NULL, redirect_uri TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS google_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT UNIQUE NOT NULL,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('oauth_user','service_account')),
  oauth_app_id INTEGER REFERENCES google_oauth_apps(id) ON DELETE RESTRICT,
  google_email TEXT, google_project_id TEXT,
  access_token_enc BLOB, refresh_token_enc BLOB, service_account_json_enc BLOB,
  expires_at INTEGER NOT NULL DEFAULT 0, scopes_granted TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
`;

export function tenantDir(userId: number): string {
  const dir = join(TENANT_ROOT, String(userId));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Writes the user's current tokens into the SQLite file an ohmy-seo server
 * reads. Refresh tokens deliberately stay in Postgres: the child process is
 * handed a short-lived access token and a placeholder, and `refreshTenant`
 * rewrites the row before it can expire. That way a compromised child cannot
 * mint new tokens, and Yandex's rotating refresh tokens never desync.
 */
export function materialize(userId: number, accounts: Account[]): string {
  const dir = tenantDir(userId);
  const dbPath = join(dir, "state.db");
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA);
    const key = tenantKey(userId);
    const now = Math.floor(Date.now() / 1000);
    const placeholder = encryptWith(key, "server-managed");

    const yandexApp = db
      .prepare(
        `INSERT INTO oauth_apps (label, client_id, client_secret_enc, scopes_declared, created_at)
         VALUES ('ohmy-seo', ?, ?, ?, ?)
         ON CONFLICT(label) DO UPDATE SET client_id = excluded.client_id
         RETURNING id`,
      )
      .get(
        process.env.YANDEX_CLIENT_ID ?? "",
        encryptWith(key, "server-managed"),
        process.env.YANDEX_SCOPES ?? "",
        now,
      ) as { id: number } | undefined;

    const googleApp = db
      .prepare(
        `INSERT INTO google_oauth_apps (label, client_id, client_secret_enc, scopes_declared, redirect_uri, created_at)
         VALUES ('ohmy-seo', ?, ?, ?, ?, ?)
         ON CONFLICT(label) DO UPDATE SET client_id = excluded.client_id
         RETURNING id`,
      )
      .get(
        process.env.GOOGLE_CLIENT_ID ?? "",
        encryptWith(key, "server-managed"),
        process.env.GOOGLE_SCOPES ?? "",
        `${process.env.APP_URL ?? ""}/api/oauth/google/callback`,
        now,
      ) as { id: number } | undefined;

    const upsertYandex = db.prepare(
      `INSERT INTO accounts
         (label, oauth_app_id, yandex_login, access_token_enc, refresh_token_enc,
          expires_at, scopes_granted, is_default, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(label) DO UPDATE SET
         access_token_enc = excluded.access_token_enc,
         expires_at = excluded.expires_at,
         scopes_granted = excluded.scopes_granted,
         is_default = excluded.is_default,
         updated_at = excluded.updated_at`,
    );
    const upsertGoogle = db.prepare(
      `INSERT INTO google_accounts
         (label, auth_method, oauth_app_id, google_email, access_token_enc, refresh_token_enc,
          expires_at, scopes_granted, is_default, created_at, updated_at)
       VALUES (?,'oauth_user',?,?,?,?,?,?,?,?,?)
       ON CONFLICT(label) DO UPDATE SET
         access_token_enc = excluded.access_token_enc,
         expires_at = excluded.expires_at,
         scopes_granted = excluded.scopes_granted,
         is_default = excluded.is_default,
         updated_at = excluded.updated_at`,
    );

    db.transaction(() => {
      // Derived tenant cache: remove disconnected access, retaining IDs of
      // accounts that are still connected.
      const yandexLabels = accounts.filter(a => a.provider !== "google")
        .map(a => a.provider === "yandex-direct" ? `${a.label} (Директ)` : a.label);
      const googleLabels = accounts.filter(a => a.provider === "google").map(a => a.label);
      for (const [table, labels] of [["accounts", yandexLabels], ["google_accounts", googleLabels]] as const) {
        db.prepare(`DELETE FROM ${table} WHERE label NOT IN (SELECT value FROM json_each(?))`)
          .run(JSON.stringify(labels));
      }
      for (const a of accounts) {
        const exp = Math.floor(a.expiresAt.getTime() / 1000);
        const enc = encryptWith(key, a.accessToken);
        if ((a.provider === "yandex" || a.provider === "yandex-direct") && yandexApp) {
          // Same Yandex login arrives twice — once per OAuth app — so the
          // Direct row is labelled apart to keep both tokens usable.
          const label = a.provider === "yandex-direct" ? `${a.label} (Директ)` : a.label;
          upsertYandex.run(
            label, yandexApp.id, a.login, enc, placeholder,
            exp, a.scopes, a.isDefault ? 1 : 0, now, now,
          );
        } else if (a.provider === "google" && googleApp) {
          upsertGoogle.run(
            a.label, googleApp.id, a.email, enc, placeholder,
            exp, a.scopes, a.isDefault ? 1 : 0, now, now,
          );
        }
      }
    })();
  } finally {
    db.close();
  }
  return dbPath;
}

const SKEW_MS = 5 * 60 * 1000;

type ProviderCfg = { tokenUrl: string; clientId: string; clientSecret: string };

function providerCfg(provider: Provider): ProviderCfg {
  if (provider === "yandex") {
    return {
      tokenUrl: "https://oauth.yandex.ru/token",
      clientId: process.env.YANDEX_CLIENT_ID ?? "",
      clientSecret: process.env.YANDEX_CLIENT_SECRET ?? "",
    };
  }
  if (provider === "yandex-direct") {
    return {
      tokenUrl: "https://oauth.yandex.ru/token",
      clientId: process.env.YANDEX_DIRECT_CLIENT_ID ?? "",
      clientSecret: process.env.YANDEX_DIRECT_CLIENT_SECRET ?? "",
    };
  }
  return {
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  };
}

/**
 * Refreshes any connection due to expire within the next 5 minutes and writes
 * the result back to Postgres, so the web app and the gateway never hold
 * divergent copies of a rotating refresh token.
 */
export async function ensureFreshAccounts(userId: number): Promise<Account[]> {
  const key = platformKey();
  const due = await pool.query<{
    id: string; provider: Provider; refresh_token_enc: Buffer | null;
  }>(
    `SELECT id, provider, refresh_token_enc
       FROM connections
      WHERE user_id = $1 AND revoked_at IS NULL
        AND expires_at < now() + interval '5 minutes'`,
    [userId],
  );

  for (const row of due.rows) {
    if (!row.refresh_token_enc) continue;
    const cfg = providerCfg(row.provider);
    try {
      const res = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: decryptWith(key, row.refresh_token_enc),
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
        }),
      });
      if (!res.ok) {
        console.error(`[tenant] refresh ${row.provider} #${row.id} -> ${res.status}`);
        continue;
      }
      const d = (await res.json()) as {
        access_token: string; refresh_token?: string; expires_in?: number;
      };
      await pool.query(
        `UPDATE connections
            SET access_token_enc = $1,
                refresh_token_enc = COALESCE($2, refresh_token_enc),
                expires_at = $3, updated_at = now()
          WHERE id = $4`,
        [
          encryptWith(key, d.access_token),
          d.refresh_token ? encryptWith(key, d.refresh_token) : null,
          new Date(Date.now() + (d.expires_in ?? 3600) * 1000),
          row.id,
        ],
      );
    } catch (e) {
      console.error(`[tenant] refresh failed for #${row.id}:`, e);
    }
  }

  const accounts = await loadAccounts(userId);
  return accounts.filter((a) => a.expiresAt.getTime() - Date.now() > -SKEW_MS);
}

export async function authenticate(presented: string): Promise<number | null> {
  const r = await pool.query<{ user_id: string; id: string }>(
    "SELECT id, user_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
    [hashApiKey(presented)],
  );
  if (r.rowCount === 0) return null;
  void pool
    .query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [r.rows[0].id])
    .catch(() => undefined);
  return Number(r.rows[0].user_id);
}
