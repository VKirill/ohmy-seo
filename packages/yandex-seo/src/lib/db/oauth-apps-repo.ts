import { getDb } from "@ohmy-seo/mcp-core/db";
import { encryptSecret, decryptSecret } from "@ohmy-seo/mcp-core/crypto";

export type OauthAppRow = {
  id: number;
  label: string;
  client_id: string;
  client_secret: string;      // plaintext (decrypted)
  scopes_declared: string;
  created_at: number;
};

export type OauthAppPublic = Omit<OauthAppRow, "client_secret">;

type AppDbRow = {
  id: number;
  label: string;
  client_id: string;
  client_secret_enc: Buffer;
  scopes_declared: string;
  created_at: number;
};

function rowToPublic(row: AppDbRow): OauthAppPublic {
  return {
    id: row.id,
    label: row.label,
    client_id: row.client_id,
    scopes_declared: row.scopes_declared,
    created_at: row.created_at,
  };
}

function rowToFull(row: AppDbRow): OauthAppRow {
  return {
    ...rowToPublic(row),
    client_secret: decryptSecret(row.client_secret_enc),
  };
}

export function listApps(): OauthAppPublic[] {
  const db = getDb();
  const rows = db
    .prepare<[], AppDbRow>(
      "SELECT id, label, client_id, client_secret_enc, scopes_declared, created_at FROM oauth_apps ORDER BY id"
    )
    .all();
  return rows.map(rowToPublic);
}

export function registerApp(input: {
  label: string;
  client_id: string;
  client_secret: string;
  scopes_declared: string;
}): OauthAppPublic {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const enc = encryptSecret(input.client_secret);

  let id: number;
  try {
    const stmt = db.prepare<[string, string, Buffer, string, number]>(
      "INSERT INTO oauth_apps (label, client_id, client_secret_enc, scopes_declared, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const result = stmt.run(input.label, input.client_id, enc, input.scopes_declared, now);
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
    created_at: now,
  };
}

export function getAppByLabel(label: string): OauthAppRow | null {
  const db = getDb();
  const row = db
    .prepare<[string], AppDbRow>(
      "SELECT id, label, client_id, client_secret_enc, scopes_declared, created_at FROM oauth_apps WHERE label = ?"
    )
    .get(label);
  return row ? rowToFull(row) : null;
}

export function getAppById(id: number): OauthAppRow | null {
  const db = getDb();
  const row = db
    .prepare<[number], AppDbRow>(
      "SELECT id, label, client_id, client_secret_enc, scopes_declared, created_at FROM oauth_apps WHERE id = ?"
    )
    .get(id);
  return row ? rowToFull(row) : null;
}

export function deleteAppByLabel(label: string): void {
  const db = getDb();

  db.transaction(() => {
    const app = db
      .prepare<[string], { id: number }>("SELECT id FROM oauth_apps WHERE label = ?")
      .get(label);
    if (!app) {
      throw new Error(`OAuth app "${label}" not found`);
    }

    const attached = db
      .prepare<[number], { label: string }>(
        "SELECT label FROM accounts WHERE oauth_app_id = ?"
      )
      .all(app.id);

    if (attached.length > 0) {
      const list = attached.map((r) => r.label).join(", ");
      throw new Error(`Cannot delete: accounts attached: ${list}`);
    }

    db.prepare<[number]>("DELETE FROM oauth_apps WHERE id = ?").run(app.id);
  })();
}

if (process.argv[2] === "smoke") {
  const app = registerApp({
    label: "smoke-test",
    client_id: "test-cid",
    client_secret: "test-cs",
    scopes_declared: "metrika:read",
  });
  console.log("registered:", app); // guardian: allow
  const full = getAppByLabel("smoke-test");
  console.log("decrypted secret match:", full?.client_secret === "test-cs"); // guardian: allow
  deleteAppByLabel("smoke-test");
  console.log("OK"); // guardian: allow
}
