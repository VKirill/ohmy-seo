import { pool, ensureSchema, audit } from "./db";
import { hashApiKey, newApiKey } from "./crypto";

export type ApiKeyOwner = { userId: number; keyId: number; allowTokenExport: boolean };

/** Resolves `Authorization: Bearer ohmy_...` to its owner, or null. */
export async function authenticateApiKey(req: Request): Promise<ApiKeyOwner | null> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  const presented = m?.[1] ?? req.headers.get("x-api-key");
  if (!presented || !/^ohmy_[A-Za-z0-9_-]{32}$/.test(presented)) return null;

  await ensureSchema();
  // Lookup is by SHA-256 of the key, so the plaintext is never stored and the
  // comparison happens inside Postgres on a unique index.
  const r = await pool.query<{ id: string; user_id: string; allow_token_export: boolean }>(
    "SELECT id, user_id, allow_token_export FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
    [hashApiKey(presented)],
  );
  if (r.rowCount === 0) return null;

  void pool
    .query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [r.rows[0].id])
    .catch(() => undefined);

  return { userId: Number(r.rows[0].user_id), keyId: Number(r.rows[0].id), allowTokenExport: r.rows[0].allow_token_export };
}

export async function createApiKey(userId: number, name: string, allowTokenExport = false): Promise<string> {
  await ensureSchema();
  const { plain, hash, prefix } = newApiKey();
  await pool.query(
    "INSERT INTO api_keys (user_id, name, key_hash, key_prefix, allow_token_export) VALUES ($1,$2,$3,$4,$5)",
    [userId, name.slice(0, 80) || "MCP", hash, prefix, allowTokenExport],
  );
  await audit(userId, "api_key.created", { allowTokenExport });
  return plain;
}

export async function listApiKeys(userId: number) {
  await ensureSchema();
  const r = await pool.query<{
    id: string; name: string; key_prefix: string;
    last_used_at: Date | null; created_at: Date; allow_token_export: boolean;
  }>(
    `SELECT id, name, key_prefix, last_used_at, created_at, allow_token_export
       FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
    [userId],
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    name: x.name,
    prefix: x.key_prefix,
    lastUsedAt: x.last_used_at,
    createdAt: x.created_at,
    allowTokenExport: x.allow_token_export,
  }));
}

export async function revokeApiKey(userId: number, keyId: number): Promise<void> {
  await ensureSchema();
  await pool.query(
    "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2",
    [keyId, userId],
  );
}
