import type Database from "better-sqlite3";

const MIGRATION_V1_SQL = `
  CREATE TABLE IF NOT EXISTS oauth_apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT UNIQUE NOT NULL,
    client_id TEXT NOT NULL,
    client_secret_enc BLOB NOT NULL,
    scopes_declared TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT UNIQUE NOT NULL,
    oauth_app_id INTEGER NOT NULL REFERENCES oauth_apps(id) ON DELETE RESTRICT,
    yandex_login TEXT,
    webmaster_user_id INTEGER,
    access_token_enc BLOB NOT NULL,
    refresh_token_enc BLOB NOT NULL,
    expires_at INTEGER NOT NULL,
    scopes_granted TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_accounts_default ON accounts(is_default) WHERE is_default = 1;
`;

const MIGRATION_V2_SQL = `
  CREATE TABLE IF NOT EXISTS inv_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    host_id TEXT NOT NULL,
    ascii_host_url TEXT NOT NULL,
    unicode_host_url TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    main_mirror INTEGER NOT NULL DEFAULT 0,
    indexed_pages INTEGER,
    fetched_at INTEGER NOT NULL,
    UNIQUE (account_id, host_id)
  );
  CREATE INDEX IF NOT EXISTS idx_inv_sites_account ON inv_sites(account_id);
  CREATE INDEX IF NOT EXISTS idx_inv_sites_ascii   ON inv_sites(ascii_host_url);

  CREATE TABLE IF NOT EXISTS inv_counters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    counter_id TEXT NOT NULL,
    name TEXT,
    site TEXT,
    status TEXT,
    permission TEXT,
    fetched_at INTEGER NOT NULL,
    UNIQUE (account_id, counter_id)
  );
  CREATE INDEX IF NOT EXISTS idx_inv_counters_account ON inv_counters(account_id);
  CREATE INDEX IF NOT EXISTS idx_inv_counters_name    ON inv_counters(name);

  CREATE TABLE IF NOT EXISTS inv_refresh_meta (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('sites','counters')),
    last_refresh_success_at INTEGER,
    last_refresh_attempt_at INTEGER,
    last_error TEXT,
    PRIMARY KEY (account_id, kind)
  );
`;

const MIGRATION_V3_SQL = `
  CREATE TABLE IF NOT EXISTS query_cache (
    args_hash TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    args_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    last_hit_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_query_cache_tool    ON query_cache(tool_name);
  CREATE INDEX IF NOT EXISTS idx_query_cache_account ON query_cache(account_id);
  CREATE INDEX IF NOT EXISTS idx_query_cache_expires ON query_cache(expires_at);
  CREATE INDEX IF NOT EXISTS idx_query_cache_fetched ON query_cache(fetched_at);
`;

// ---------------------------------------------------------------------------
// V4: Remove FK on query_cache.account_id, add account_namespace column.
//     Create google_oauth_apps, google_accounts, gtm_rollback_plans tables.
//
// The query_cache rebuild is idempotent — guarded by PRAGMA table_info check.
// SQLite does not support DROP CONSTRAINT so we do a full table rebuild.
// ---------------------------------------------------------------------------

function applyMigrationV4(db: Database.Database): void {
  // Step 1: Patch query_cache — only if account_namespace column not yet present.
  const columns = db.pragma("table_info(query_cache)") as Array<{ name: string }>;
  const hasNamespace = columns.some((c) => c.name === "account_namespace");

  if (!hasNamespace) {
    db.transaction(() => {
      // Rebuild table without FK and with account_namespace column.
      // account_id stays as soft reference (no FK constraint).
      db.exec(`
        CREATE TABLE query_cache_v4 (
          args_hash          TEXT PRIMARY KEY,
          tool_name          TEXT NOT NULL,
          account_namespace  TEXT,
          account_id         INTEGER,
          args_json          TEXT NOT NULL,
          response_json      TEXT NOT NULL,
          fetched_at         INTEGER NOT NULL,
          expires_at         INTEGER NOT NULL,
          hit_count          INTEGER NOT NULL DEFAULT 0,
          last_hit_at        INTEGER
        );
        INSERT INTO query_cache_v4
          (args_hash, tool_name, account_namespace, account_id,
           args_json, response_json, fetched_at, expires_at, hit_count, last_hit_at)
        SELECT
          args_hash,
          tool_name,
          CASE WHEN account_id IS NOT NULL THEN 'yandex' ELSE NULL END,
          account_id,
          args_json,
          response_json,
          fetched_at,
          expires_at,
          hit_count,
          last_hit_at
        FROM query_cache;
        DROP TABLE query_cache;
        ALTER TABLE query_cache_v4 RENAME TO query_cache;
        CREATE INDEX IF NOT EXISTS idx_query_cache_tool      ON query_cache(tool_name);
        CREATE INDEX IF NOT EXISTS idx_query_cache_namespace ON query_cache(account_namespace);
        CREATE INDEX IF NOT EXISTS idx_query_cache_account   ON query_cache(account_id);
        CREATE INDEX IF NOT EXISTS idx_query_cache_expires   ON query_cache(expires_at);
        CREATE INDEX IF NOT EXISTS idx_query_cache_fetched   ON query_cache(fetched_at);
      `);
    })();
  }

  // Step 2: Google OAuth tables (idempotent via CREATE IF NOT EXISTS).
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_oauth_apps (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      label              TEXT UNIQUE NOT NULL,
      client_id          TEXT NOT NULL,
      client_secret_enc  BLOB NOT NULL,
      scopes_declared    TEXT NOT NULL,
      redirect_uri       TEXT NOT NULL,
      created_at         INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS google_accounts (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      label                     TEXT UNIQUE NOT NULL,
      auth_method               TEXT NOT NULL CHECK (auth_method IN ('oauth_user','service_account')),
      oauth_app_id              INTEGER REFERENCES google_oauth_apps(id) ON DELETE RESTRICT,
      google_email              TEXT,
      google_project_id         TEXT,
      access_token_enc          BLOB,
      refresh_token_enc         BLOB,
      service_account_json_enc  BLOB,
      expires_at                INTEGER NOT NULL DEFAULT 0,
      scopes_granted            TEXT NOT NULL,
      is_default                INTEGER NOT NULL DEFAULT 0,
      created_at                INTEGER NOT NULL,
      updated_at                INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_google_accounts_default
      ON google_accounts(is_default) WHERE is_default = 1;
  `);

  // Step 3: GTM rollback plans table (idempotent via CREATE IF NOT EXISTS).
  db.exec(`
    CREATE TABLE IF NOT EXISTS gtm_rollback_plans (
      id               TEXT PRIMARY KEY,
      account_id       INTEGER NOT NULL,
      gtm_account_id   TEXT NOT NULL,
      container_id     TEXT NOT NULL,
      workspace_id     TEXT NOT NULL,
      from_version_id  TEXT NOT NULL,
      to_version_id    TEXT NOT NULL,
      fingerprint      TEXT NOT NULL,
      expires_at       INTEGER NOT NULL,
      created_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gtm_rollback_plans_expires
      ON gtm_rollback_plans(expires_at);
  `);
}

export function applyMigrations(db: Database.Database): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion < 1) {
    db.transaction(() => {
      db.exec(MIGRATION_V1_SQL);
      db.pragma("user_version = 1");
    })();
  }

  if (currentVersion < 2) {
    db.transaction(() => {
      db.exec(MIGRATION_V2_SQL);
      db.pragma("user_version = 2");
    })();
  }

  if (currentVersion < 3) {
    db.transaction(() => {
      db.exec(MIGRATION_V3_SQL);
      db.pragma("user_version = 3");
    })();
  }

  if (currentVersion < 4) {
    applyMigrationV4(db);
    db.pragma("user_version = 4");
  }
}
