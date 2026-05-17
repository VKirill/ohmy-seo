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

export function applyMigrations(db: Database.Database): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion >= 1) {
    return;
  }

  db.transaction(() => {
    db.exec(MIGRATION_V1_SQL);
    db.pragma("user_version = 1");
  })();
}
