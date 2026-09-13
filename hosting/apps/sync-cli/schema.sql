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
