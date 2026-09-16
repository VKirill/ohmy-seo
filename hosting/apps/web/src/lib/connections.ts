import { pool, ensureSchema, audit } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { refreshTokens, revokeAtProvider, type Identity, type TokenSet } from "./oauth";
import type { ProviderId } from "./providers";
import { cacheDel, cacheGet, cacheSet } from "./redis";

export type Connection = {
  id: number;
  provider: ProviderId;
  label: string;
  accountEmail: string | null;
  accountLogin: string | null;
  scopes: string[];
  expiresAt: Date;
  isLoginIdentity: boolean;
  createdAt: Date;
};

type Row = {
  id: string;
  provider: ProviderId;
  label: string;
  account_email: string | null;
  account_login: string | null;
  scopes_granted: string;
  expires_at: Date;
  is_login_identity: boolean;
  created_at: Date;
};

function toConnection(r: Row): Connection {
  return {
    id: Number(r.id),
    provider: r.provider,
    label: r.label,
    accountEmail: r.account_email,
    accountLogin: r.account_login,
    scopes: r.scopes_granted.split(/\s+/).filter(Boolean),
    expiresAt: r.expires_at,
    isLoginIdentity: r.is_login_identity,
    createdAt: r.created_at,
  };
}

export async function listConnections(userId: number): Promise<Connection[]> {
  await ensureSchema();
  const r = await pool.query<Row>(
    `SELECT id, provider, label, account_email, account_login, scopes_granted,
            expires_at, is_login_identity, created_at
       FROM connections
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY created_at`,
    [userId],
  );
  return r.rows.map(toConnection);
}

/** Upserts a data connection inside an authenticated cabinet. Never creates a user. */
export async function upsertConnection(opts: {
  provider: ProviderId;
  identity: Identity;
  tokens: TokenSet;
  userId: number;
}): Promise<{ userId: number; connectionId: number }> {
  if (!Number.isSafeInteger(opts.userId) || opts.userId <= 0) throw new Error("unauthorized");
  await ensureSchema();
  const { provider, identity, tokens } = opts;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query<{ id: string; user_id: string }>(
      "SELECT id, user_id FROM connections WHERE provider = $1 AND subject = $2",
      [provider, identity.subject],
    );

    if (opts.userId !== null && existing.rows[0] && Number(existing.rows[0].user_id) !== opts.userId) {
      throw new Error("Этот аккаунт уже подключён к другому кабинету");
    }

    const userId = opts.userId;

    // Yandex only returns a refresh token on the first authorisation of a
    // given app+account pair; keep the stored one when the response omits it.
    const label = identity.login ?? identity.email ?? identity.subject;
    const expiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000);
    const accessEnc = encryptSecret(tokens.accessToken);
    const refreshEnc = tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null;

    const upsert = await client.query<{ id: string }>(
      `INSERT INTO connections
         (user_id, provider, subject, account_email, account_login, label,
          access_token_enc, refresh_token_enc, expires_at, scopes_granted, is_login_identity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (provider, subject) DO UPDATE SET
         account_email     = EXCLUDED.account_email,
         account_login     = EXCLUDED.account_login,
         label             = EXCLUDED.label,
         access_token_enc  = EXCLUDED.access_token_enc,
         refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, connections.refresh_token_enc),
         expires_at        = EXCLUDED.expires_at,
         scopes_granted    = EXCLUDED.scopes_granted,
         revoked_at        = NULL,
         updated_at        = now()
       WHERE connections.user_id = EXCLUDED.user_id
       RETURNING id`,
      [
        userId, provider, identity.subject, identity.email, identity.login, label,
        accessEnc, refreshEnc, expiresAt, tokens.scope, false,
      ],
    );

    if (!upsert.rows[0]) throw new Error("Этот аккаунт уже подключён к другому кабинету");
    await client.query("COMMIT");
    const connectionId = Number(upsert.rows[0].id);
    await cacheDel(`tok:${connectionId}`);
    await audit(userId, "connection.authorized", { provider, label }, connectionId);
    return { userId, connectionId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

const SKEW_SECONDS = 120;

/**
 * Returns a currently-valid access token, refreshing it if needed. Cached in
 * Redis until shortly before expiry so a busy MCP session does not hammer the
 * provider's token endpoint.
 */
export async function accessTokenFor(
  userId: number,
  connectionId: number,
): Promise<{ accessToken: string; expiresAt: Date; provider: ProviderId }> {
  await ensureSchema();
  const r = await pool.query<{
    provider: ProviderId;
    access_token_enc: Buffer;
    refresh_token_enc: Buffer | null;
    expires_at: Date;
    scopes_granted: string;
  }>(
    `SELECT provider, access_token_enc, refresh_token_enc, expires_at, scopes_granted
       FROM connections WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [connectionId, userId],
  );
  if (r.rowCount === 0) throw new Error("connection not found");
  const row = r.rows[0];

  const cached = await cacheGet(`tok:${connectionId}`);
  if (cached) {
    const c = JSON.parse(cached) as { t?: string; enc?: string; e: number };
    if (c.enc && c.e - Date.now() > SKEW_SECONDS * 1000) {
      return { accessToken: decryptSecret(Buffer.from(c.enc, "base64")), expiresAt: new Date(c.e), provider: row.provider };
    }
  }

  const stillValid = row.expires_at.getTime() - Date.now() > SKEW_SECONDS * 1000;
  if (stillValid) {
    const token = decryptSecret(row.access_token_enc);
    await cacheTokenValue(connectionId, token, row.expires_at);
    return { accessToken: token, expiresAt: row.expires_at, provider: row.provider };
  }

  if (!row.refresh_token_enc) {
    throw new Error("access token expired and no refresh token is stored; re-authorise the account");
  }

  const fresh = await refreshTokens(row.provider, decryptSecret(row.refresh_token_enc));
  const expiresAt = new Date(Date.now() + fresh.expiresInSeconds * 1000);
  await pool.query(
    `UPDATE connections
        SET access_token_enc  = $1,
            refresh_token_enc = COALESCE($2, refresh_token_enc),
            expires_at = $3, updated_at = now()
      WHERE id = $4`,
    [
      encryptSecret(fresh.accessToken),
      fresh.refreshToken ? encryptSecret(fresh.refreshToken) : null,
      expiresAt,
      connectionId,
    ],
  );
  await cacheTokenValue(connectionId, fresh.accessToken, expiresAt);
  await audit(userId, "connection.refreshed", { provider: row.provider }, connectionId);
  return { accessToken: fresh.accessToken, expiresAt, provider: row.provider };
}

async function cacheTokenValue(connectionId: number, token: string, expiresAt: Date): Promise<void> {
  const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000) - SKEW_SECONDS;
  if (ttl > 0) {
    await cacheSet(`tok:${connectionId}`, JSON.stringify({ enc: encryptSecret(token).toString("base64"), e: expiresAt.getTime() }), ttl);
  }
}

/** True when we already hold a refresh token for this external account. */
export async function hasStoredRefreshToken(
  provider: ProviderId,
  subject: string,
): Promise<boolean> {
  await ensureSchema();
  const r = await pool.query<{ present: boolean }>(
    `SELECT refresh_token_enc IS NOT NULL AS present
       FROM connections WHERE provider = $1 AND subject = $2 AND revoked_at IS NULL`,
    [provider, subject],
  );
  return r.rowCount !== 0 && r.rows[0].present;
}

export async function revokeConnection(userId: number, connectionId: number): Promise<void> {
  await ensureSchema();
  const r = await pool.query<{ provider: ProviderId; access_token_enc: Buffer; refresh_token_enc: Buffer | null }>(
    `SELECT provider, access_token_enc, refresh_token_enc
       FROM connections WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [connectionId, userId],
  );
  const row = r.rows[0];
  if (row) {
    const enc = row.refresh_token_enc ?? row.access_token_enc;
    if (enc.length > 0) await revokeAtProvider(row.provider, decryptSecret(enc));
  }
  // Erase the secrets themselves, not just flag the row: the privacy policy
  // promises that disconnecting deletes stored tokens.
  await pool.query(
    `UPDATE connections
        SET revoked_at = now(), access_token_enc = '\\x'::bytea, refresh_token_enc = NULL, updated_at = now()
      WHERE id = $1 AND user_id = $2`,
    [connectionId, userId],
  );
  await cacheDel(`tok:${connectionId}`);
  await audit(userId, "connection.revoked", {}, connectionId);
}
