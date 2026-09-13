import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../db';
import { encryptSecret, decryptSecret } from '../crypto';
import { upsertConnection } from '../connections';
import { authorizeUrl, PROVIDERS, redirectUri, type TokenSet } from './index';

export function codeConnectionConfigured(): boolean {
  return Boolean(process.env.YANDEX_API_CLIENT_ID && process.env.YANDEX_API_CLIENT_SECRET);
}

export async function beginCodeConnection(userId: number): Promise<{ id: string; url: string }> {
  if (!codeConnectionConfigured()) throw new Error('not_configured');
  const id = randomBytes(24).toString('hex');
  const verifier = randomBytes(48).toString('base64url');
  const clientId = PROVIDERS['yandex-api'].clientId();
  await pool.query('DELETE FROM oauth_code_attempts WHERE expires_at < now()');
  await pool.query(
    "INSERT INTO oauth_code_attempts(id,user_id,client_id,verifier_enc,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
    [id, userId, clientId, encryptSecret(verifier)],
  );
  const url = new URL(authorizeUrl('yandex-api', id, true));
  url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
  url.searchParams.set('code_challenge_method', 'S256');
  return { id, url: url.toString() };
}

export async function completeCodeConnection(userId: number, id: string, rawCode: string): Promise<void> {
  const code = rawCode.trim();
  if (!/^[a-f0-9]{48}$/.test(id) || !/^[a-zA-Z0-9_-]{4,128}$/.test(code)) throw new Error('invalid_code');
  if (!codeConnectionConfigured()) throw new Error('not_configured');
  // Atomic consumption prevents concurrent submissions and replay. A failed
  // exchange requires a new authorization, with a new PKCE verifier.
  const result = await pool.query<{ verifier_enc: Buffer }>(
    'DELETE FROM oauth_code_attempts WHERE id=$1 AND user_id=$2 AND client_id=$3 AND expires_at > now() RETURNING verifier_enc',
    [id, userId, PROVIDERS['yandex-api'].clientId()],
  );
  if (result.rows.length !== 1) throw new Error('expired_attempt');
  const response = await fetch(PROVIDERS['yandex-api'].tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code,
      client_id: PROVIDERS['yandex-api'].clientId(),
      client_secret: PROVIDERS['yandex-api'].clientSecret(),
      redirect_uri: redirectUri('yandex-api'),
      code_verifier: decryptSecret(result.rows[0].verifier_enc),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  // Never surface provider response bodies: they may contain credentials.
  if (!response.ok) throw new Error('exchange_failed');
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!data.access_token || !data.refresh_token || !Number.isFinite(data.expires_in) || Number(data.expires_in) <= 0) throw new Error('invalid_token_response');
  const scope = data.scope ?? PROVIDERS['yandex-api'].scopes.join(' ');
  const granted = new Set(scope.split(/\s+/));
  if (!PROVIDERS['yandex-api'].scopes.every(s => granted.has(s))) throw new Error('missing_scopes');
  const tokens: TokenSet = { accessToken: data.access_token, refreshToken: data.refresh_token,
    expiresInSeconds: Number(data.expires_in), scope };
  const identity = await PROVIDERS['yandex-api'].identity(tokens.accessToken);
  await upsertConnection({ provider: 'yandex-api', userId, identity, tokens });
}
