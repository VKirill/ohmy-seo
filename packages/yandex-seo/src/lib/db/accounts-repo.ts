import { getDb } from "@ohmy-seo/mcp-core/db";
import { encryptSecret, decryptSecret } from "@ohmy-seo/mcp-core/crypto";

export type AccountRow = {
  id: number;
  label: string;
  oauth_app_id: number;
  yandex_login: string | null;
  webmaster_user_id: number | null;
  access_token: string;       // plaintext
  refresh_token: string;      // plaintext
  expires_at: number;
  scopes_granted: string;
  is_default: number;
  created_at: number;
  updated_at: number;
};

export type AccountPublic = Omit<AccountRow, "access_token" | "refresh_token"> & {
  oauth_app_label: string;    // join
};

type AccountDbRow = {
  id: number;
  label: string;
  oauth_app_id: number;
  yandex_login: string | null;
  webmaster_user_id: number | null;
  access_token_enc: Buffer;
  refresh_token_enc: Buffer;
  expires_at: number;
  scopes_granted: string;
  is_default: number;
  created_at: number;
  updated_at: number;
};

type AccountPublicDbRow = {
  id: number;
  label: string;
  oauth_app_id: number;
  yandex_login: string | null;
  webmaster_user_id: number | null;
  expires_at: number;
  scopes_granted: string;
  is_default: number;
  created_at: number;
  updated_at: number;
  oauth_app_label: string;
};

function dbRowToPublic(row: AccountPublicDbRow): AccountPublic {
  return {
    id: row.id,
    label: row.label,
    oauth_app_id: row.oauth_app_id,
    yandex_login: row.yandex_login,
    webmaster_user_id: row.webmaster_user_id,
    expires_at: row.expires_at,
    scopes_granted: row.scopes_granted,
    is_default: row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
    oauth_app_label: row.oauth_app_label,
  };
}

function dbRowToFull(row: AccountDbRow): AccountRow {
  return {
    id: row.id,
    label: row.label,
    oauth_app_id: row.oauth_app_id,
    yandex_login: row.yandex_login,
    webmaster_user_id: row.webmaster_user_id,
    access_token: decryptSecret(row.access_token_enc),
    refresh_token: decryptSecret(row.refresh_token_enc),
    expires_at: row.expires_at,
    scopes_granted: row.scopes_granted,
    is_default: row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listAccounts(): AccountPublic[] {
  const db = getDb();
  const rows = db
    .prepare<[], AccountPublicDbRow>(
      `SELECT
        a.id, a.label, a.oauth_app_id, a.yandex_login, a.webmaster_user_id,
        a.expires_at, a.scopes_granted, a.is_default, a.created_at, a.updated_at,
        o.label AS oauth_app_label
       FROM accounts a
       JOIN oauth_apps o ON o.id = a.oauth_app_id
       ORDER BY a.id`
    )
    .all();
  return rows.map(dbRowToPublic);
}

export function insertAccount(input: {
  label: string;
  oauth_app_id: number;
  yandex_login: string | null;
  webmaster_user_id: number | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scopes_granted: string;
}): AccountPublic {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const encAccess = encryptSecret(input.access_token);
  const encRefresh = encryptSecret(input.refresh_token);

  const stmt = db.prepare<[string, number, string | null, number | null, Buffer, Buffer, number, string, number, number]>(
    `INSERT INTO accounts
      (label, oauth_app_id, yandex_login, webmaster_user_id, access_token_enc, refresh_token_enc,
       expires_at, scopes_granted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const result = db.transaction(() => {
    return stmt.run(
      input.label,
      input.oauth_app_id,
      input.yandex_login,
      input.webmaster_user_id,
      encAccess,
      encRefresh,
      input.expires_at,
      input.scopes_granted,
      now,
      now
    );
  })();

  const id = result.lastInsertRowid as number;

  const appRow = db
    .prepare<[number], { label: string }>("SELECT label FROM oauth_apps WHERE id = ?")
    .get(input.oauth_app_id);

  return {
    id,
    label: input.label,
    oauth_app_id: input.oauth_app_id,
    yandex_login: input.yandex_login,
    webmaster_user_id: input.webmaster_user_id,
    expires_at: input.expires_at,
    scopes_granted: input.scopes_granted,
    is_default: 0,
    created_at: now,
    updated_at: now,
    oauth_app_label: appRow?.label ?? "",
  };
}

export function getAccountByLabel(label: string): AccountRow | null {
  const db = getDb();
  const row = db
    .prepare<[string], AccountDbRow>(
      `SELECT id, label, oauth_app_id, yandex_login, webmaster_user_id,
              access_token_enc, refresh_token_enc, expires_at, scopes_granted,
              is_default, created_at, updated_at
       FROM accounts WHERE label = ?`
    )
    .get(label);
  return row ? dbRowToFull(row) : null;
}

export function getAccountById(id: number): AccountRow | null {
  const db = getDb();
  const row = db
    .prepare<[number], AccountDbRow>(
      `SELECT id, label, oauth_app_id, yandex_login, webmaster_user_id,
              access_token_enc, refresh_token_enc, expires_at, scopes_granted,
              is_default, created_at, updated_at
       FROM accounts WHERE id = ?`
    )
    .get(id);
  return row ? dbRowToFull(row) : null;
}

export function updateAccountTokens(
  id: number,
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    scopes_granted?: string;
  }
): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const encAccess = encryptSecret(tokens.access_token);
  const encRefresh = encryptSecret(tokens.refresh_token);

  if (tokens.scopes_granted !== undefined) {
    db.prepare<[Buffer, Buffer, number, string, number, number]>(
      `UPDATE accounts
       SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?,
           scopes_granted = ?, updated_at = ?
       WHERE id = ?`
    ).run(encAccess, encRefresh, tokens.expires_at, tokens.scopes_granted, now, id);
  } else {
    db.prepare<[Buffer, Buffer, number, number, number]>(
      `UPDATE accounts
       SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(encAccess, encRefresh, tokens.expires_at, now, id);
  }
}

export function updateWebmasterUserId(id: number, userId: number | null): void {
  const db = getDb();
  db.prepare<[number | null, number]>(
    "UPDATE accounts SET webmaster_user_id = ? WHERE id = ?"
  ).run(userId, id);
}

export function updateYandexLogin(id: number, login: string | null): void {
  const db = getDb();
  db.prepare<[string | null, number]>(
    "UPDATE accounts SET yandex_login = ? WHERE id = ?"
  ).run(login, id);
}

export function setDefault(label: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE accounts SET is_default = 0 WHERE is_default = 1").run();
    const result = db
      .prepare<[string]>("UPDATE accounts SET is_default = 1 WHERE label = ?")
      .run(label);
    if (result.changes === 0) {
      throw new Error(`Account "${label}" not found`);
    }
  })();
}

export function deleteAccount(label: string): void {
  const db = getDb();
  db.prepare<[string]>("DELETE FROM accounts WHERE label = ?").run(label);
}
