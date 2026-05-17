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
}
