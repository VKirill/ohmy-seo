import { pool, ensureSchema } from "./db";
import { hashApiKey, newApiKey } from "./crypto";

export type ApiKeyOwner = { userId: number; keyId: number };

/** Resolves `Authorization: Bearer ohmy_...` to its owner, or null. */
export async function authenticateApiKey(req: Request): Promise<ApiKeyOwner | null> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  const presented = m?.[1] ?? req.headers.get("x-api-key");
  if (!presented) return null;

  await ensureSchema();
  // Lookup is by SHA-256 of the key, so the plaintext is never stored and the
  // comparison happens inside Postgres on a unique index.
  const r = await pool.query<{ id: string; user_id: string }>(
    "SELECT id, user_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
    [hashApiKey(presented)],
  );
  if (r.rowCount === 0) return null;

  void pool
    .query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [r.rows[0].id])
    .catch(() => undefined);

  return { userId: Number(r.rows[0].user_id), keyId: Number(r.rows[0].id) };
}

export async function createApiKey(userId: number, name: string): Promise<string> {
  await ensureSchema();
  const { plain, hash, prefix } = newApiKey();
  await pool.query(
    "INSERT INTO api_keys (user_id, name, key_hash, key_prefix) VALUES ($1,$2,$3,$4)",
    [userId, name.slice(0, 80) || "MCP", hash, prefix],
  );
  return plain;
}

export async function listApiKeys(userId: number) {
  await ensureSchema();
  const r = await pool.query<{
    id: string; name: string; key_prefix: string;
    last_used_at: Date | null; created_at: Date;
  }>(
    `SELECT id, name, key_prefix, last_used_at, created_at
       FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
    [userId],
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    name: x.name,
    prefix: x.key_prefix,
    lastUsedAt: x.last_used_at,
    createdAt: x.created_at,
  }));
}

export async function revokeApiKey(userId: number, keyId: number): Promise<void> {
  await ensureSchema();
  await pool.query(
    "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2",
    [keyId, userId],
  );
}
