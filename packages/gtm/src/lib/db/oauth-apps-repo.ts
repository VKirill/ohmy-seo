import { getDb } from "@ohmy-seo/mcp-core/db";
import { encryptSecret, decryptSecret } from "@ohmy-seo/mcp-core/crypto";

const PKG = "gtm";

export type GoogleOAuthAppRow = {
  id: number;
  label: string;
  client_id: string;
  client_secret: string;   // plaintext (decrypted)
  scopes_declared: string;
  redirect_uri: string;
  created_at: number;
};

export type GoogleOAuthAppPublic = Omit<GoogleOAuthAppRow, "client_secret">;

type AppDbRow = {
  id: number;
  label: string;
  client_id: string;
  client_secret_enc: Buffer;
  scopes_declared: string;
  redirect_uri: string;
  created_at: number;
};

function rowToPublic(row: AppDbRow): GoogleOAuthAppPublic {
  return {
    id: row.id,
    label: row.label,
    client_id: row.client_id,
    scopes_declared: row.scopes_declared,
    redirect_uri: row.redirect_uri,
    created_at: row.created_at,
  };
}

function rowToFull(row: AppDbRow): GoogleOAuthAppRow {
  return {
    ...rowToPublic(row),
    client_secret: decryptSecret(row.client_secret_enc),
  };
}

export function listOAuthApps(packageName: string = PKG): GoogleOAuthAppPublic[] {
  const db = getDb(packageName);
  const rows = db
    .prepare<[], AppDbRow>(
      `SELECT id, label, client_id, client_secret_enc, scopes_declared, redirect_uri, created_at
       FROM google_oauth_apps ORDER BY id`
    )
    .all();
  return rows.map(rowToPublic);
}

export function insertOAuthApp(
  packageName: string = PKG,
  input: {
    label: string;
    client_id: string;
    client_secret_plain: string;
    scopes_declared: string;
    redirect_uri: string;
  }
): GoogleOAuthAppPublic {
  const db = getDb(packageName);
  const now = Math.floor(Date.now() / 1000);
  const enc = encryptSecret(input.client_secret_plain);

  let id: number;
  try {
    const stmt = db.prepare<[string, string, Buffer, string, string, number]>(
      `INSERT INTO google_oauth_apps (label, client_id, client_secret_enc, scopes_declared, redirect_uri, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(
      input.label,
      input.client_id,
      enc,
      input.scopes_declared,
      input.redirect_uri,
      now
    );
    id = result.lastInsertRowid as number;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint failed")) {
      throw new Error(`OAuth app with label "${input.label}" already exists`);
    }
    throw err;
  }

  return {
    id,
    label: input.label,
    client_id: input.client_id,
    scopes_declared: input.scopes_declared,
    redirect_uri: input.redirect_uri,
    created_at: now,
  };
}

export function findOAuthAppByLabel(
  packageName: string = PKG,
  label: string
): GoogleOAuthAppRow | null {
  const db = getDb(packageName);
  const row = db
    .prepare<[string], AppDbRow>(
      `SELECT id, label, client_id, client_secret_enc, scopes_declared, redirect_uri, created_at
       FROM google_oauth_apps WHERE label = ?`
    )
    .get(label);
  return row ? rowToFull(row) : null;
}

export function deleteOAuthApp(packageName: string = PKG, id: number): void {
  const db = getDb(packageName);
  db.transaction(() => {
    const app = db
      .prepare<[number], { label: string }>(
        "SELECT label FROM google_oauth_apps WHERE id = ?"
      )
      .get(id);
    if (!app) {
      throw new Error(`OAuth app id=${id} not found`);
    }

    const attached = db
      .prepare<[number], { label: string }>(
        "SELECT label FROM google_accounts WHERE oauth_app_id = ?"
      )
      .all(id);

    if (attached.length > 0) {
      const list = attached.map((r) => r.label).join(", ");
      throw new Error(`Cannot delete: accounts attached: ${list}`);
    }

    db.prepare<[number]>("DELETE FROM google_oauth_apps WHERE id = ?").run(id);
  })();
}
