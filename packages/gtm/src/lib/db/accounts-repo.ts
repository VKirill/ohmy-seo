import { getDb } from "@ohmy-seo/mcp-core/db";
import { encryptSecret, decryptSecret } from "@ohmy-seo/mcp-core/crypto";

const PKG = "gtm";

export type GoogleAccountRow = {
  id: number;
  label: string;
  auth_method: "oauth_user" | "service_account";
  oauth_app_id: number | null;
  google_email: string | null;
  google_project_id: string | null;
  access_token: string | undefined;       // plaintext (decrypted)
  refresh_token: string | undefined;      // plaintext (decrypted)
  service_account_json: string | undefined; // plaintext (decrypted)
  expires_at: number;
  scopes_granted: string;
  is_default: number;
  created_at: number;
  updated_at: number;
};

// Public shape omits encrypted BLOBs and decrypted secrets.
export type GoogleAccountPublic = {
  id: number;
  label: string;
  auth_method: "oauth_user" | "service_account";
  oauth_app_id: number | null;
  google_email: string | null;
  google_project_id: string | null;
  expires_at: number;
  scopes_granted: string;
  is_default: number;
  created_at: number;
  updated_at: number;
};

type AccountDbRow = {
  id: number;
  label: string;
  auth_method: "oauth_user" | "service_account";
  oauth_app_id: number | null;
  google_email: string | null;
  google_project_id: string | null;
  access_token_enc: Buffer | null;
  refresh_token_enc: Buffer | null;
  service_account_json_enc: Buffer | null;
  expires_at: number;
  scopes_granted: string;
  is_default: number;
  created_at: number;
  updated_at: number;
};

function dbRowToPublic(row: AccountDbRow): GoogleAccountPublic {
  return {
    id: row.id,
    label: row.label,
    auth_method: row.auth_method,
    oauth_app_id: row.oauth_app_id,
    google_email: row.google_email,
    google_project_id: row.google_project_id,
    expires_at: row.expires_at,
    scopes_granted: row.scopes_granted,
    is_default: row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function dbRowToFull(row: AccountDbRow): GoogleAccountRow {
  return {
    ...dbRowToPublic(row),
    access_token: row.access_token_enc ? decryptSecret(row.access_token_enc) : undefined,
    refresh_token: row.refresh_token_enc ? decryptSecret(row.refresh_token_enc) : undefined,
    service_account_json: row.service_account_json_enc
      ? decryptSecret(row.service_account_json_enc)
      : undefined,
  };
}

const SELECT_COLS = `
  id, label, auth_method, oauth_app_id, google_email, google_project_id,
  access_token_enc, refresh_token_enc, service_account_json_enc,
  expires_at, scopes_granted, is_default, created_at, updated_at
`;

export function listAccounts(packageName: string = PKG): GoogleAccountPublic[] {
  const db = getDb(packageName);
  const rows = db
    .prepare<[], GoogleAccountPublic>(
      `SELECT id, label, auth_method, oauth_app_id, google_email, google_project_id,
              expires_at, scopes_granted, is_default, created_at, updated_at
       FROM google_accounts ORDER BY id`
    )
    .all();
  return rows;
}

export function insertAccount(
  packageName: string = PKG,
  input: {
    label: string;
    auth_method: "oauth_user" | "service_account";
    oauth_app_id?: number | null;
    google_email?: string | null;
    google_project_id?: string | null;
    refresh_token_plain?: string | null;
    access_token_plain?: string | null;
    service_account_json_plain?: string | null;
    expires_at: number;
    scopes_granted: string;
  }
): GoogleAccountPublic {
  const db = getDb(packageName);
  const now = Math.floor(Date.now() / 1000);

  const encAccess = input.access_token_plain ? encryptSecret(input.access_token_plain) : null;
  const encRefresh = input.refresh_token_plain ? encryptSecret(input.refresh_token_plain) : null;
  const encSaJson = input.service_account_json_plain
    ? encryptSecret(input.service_account_json_plain)
    : null;

  const stmt = db.prepare(
    `INSERT INTO google_accounts
      (label, auth_method, oauth_app_id, google_email, google_project_id,
       access_token_enc, refresh_token_enc, service_account_json_enc,
       expires_at, scopes_granted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const result = db.transaction(() =>
    stmt.run(
      input.label,
      input.auth_method,
      input.oauth_app_id ?? null,
      input.google_email ?? null,
      input.google_project_id ?? null,
      encAccess,
      encRefresh,
      encSaJson,
      input.expires_at,
      input.scopes_granted,
      now,
      now
    )
  )();

  return {
    id: result.lastInsertRowid as number,
    label: input.label,
    auth_method: input.auth_method,
    oauth_app_id: input.oauth_app_id ?? null,
    google_email: input.google_email ?? null,
    google_project_id: input.google_project_id ?? null,
    expires_at: input.expires_at,
    scopes_granted: input.scopes_granted,
    is_default: 0,
    created_at: now,
    updated_at: now,
  };
}

export function updateAccountTokens(
  packageName: string = PKG,
  id: number,
  tokens: {
    access_token_plain: string;
    refresh_token_plain?: string | null;
    expires_at: number;
    updated_at?: number;
  }
): void {
  const db = getDb(packageName);
  const now = tokens.updated_at ?? Math.floor(Date.now() / 1000);
  const encAccess = encryptSecret(tokens.access_token_plain);

  if (tokens.refresh_token_plain !== undefined) {
    const encRefresh = tokens.refresh_token_plain
      ? encryptSecret(tokens.refresh_token_plain)
      : null;
    db.prepare(
      `UPDATE google_accounts
       SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(encAccess, encRefresh, tokens.expires_at, now, id);
  } else {
    db.prepare(
      `UPDATE google_accounts
       SET access_token_enc = ?, expires_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(encAccess, tokens.expires_at, now, id);
  }
}

export function findAccountById(
  packageName: string = PKG,
  id: number
): GoogleAccountRow | null {
  const db = getDb(packageName);
  const row = db
    .prepare<[number], AccountDbRow>(`SELECT ${SELECT_COLS} FROM google_accounts WHERE id = ?`)
    .get(id);
  return row ? dbRowToFull(row) : null;
}

export function findAccountByLabel(
  packageName: string = PKG,
  label: string
): GoogleAccountRow | null {
  const db = getDb(packageName);
  const row = db
    .prepare<[string], AccountDbRow>(
      `SELECT ${SELECT_COLS} FROM google_accounts WHERE label = ?`
    )
    .get(label);
  return row ? dbRowToFull(row) : null;
}

export function getDefaultAccount(packageName: string = PKG): GoogleAccountRow | null {
  const db = getDb(packageName);
  const row = db
    .prepare<[], AccountDbRow>(
      `SELECT ${SELECT_COLS} FROM google_accounts WHERE is_default = 1 LIMIT 1`
    )
    .get();
  return row ? dbRowToFull(row) : null;
}

export function setDefaultAccount(packageName: string = PKG, id: number): void {
  const db = getDb(packageName);
  db.transaction(() => {
    db.prepare("UPDATE google_accounts SET is_default = 0 WHERE is_default = 1").run();
    const result = db
      .prepare<[number]>("UPDATE google_accounts SET is_default = 1 WHERE id = ?")
      .run(id);
    if (result.changes === 0) {
      throw new Error(`Account id=${id} not found`);
    }
  })();
}

export function deleteAccount(packageName: string = PKG, id: number): void {
  const db = getDb(packageName);
  db.prepare<[number]>("DELETE FROM google_accounts WHERE id = ?").run(id);
}
