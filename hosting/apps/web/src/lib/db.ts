import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __ohmyPool: Pool | undefined;
}

export const pool =
  global.__ohmyPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") global.__ohmyPool = pool;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- One row per external account the user has authorised us to act on behalf of.
-- Sign-in identities are stored separately; connections grant data access only.
CREATE TABLE IF NOT EXISTS connections (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  subject           TEXT NOT NULL,
  account_email     TEXT,
  account_login     TEXT,
  label             TEXT NOT NULL,
  access_token_enc  BYTEA NOT NULL,
  refresh_token_enc BYTEA,
  expires_at        TIMESTAMPTZ NOT NULL,
  scopes_granted    TEXT NOT NULL,
  is_login_identity BOOLEAN NOT NULL DEFAULT false,
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_connections_user ON connections(user_id) WHERE revoked_at IS NULL;

-- Provider list is enforced here rather than inline so adding one (Direct
-- needed its own OAuth app once Yandex's three-service cap was hit) is a
-- constraint swap instead of a table rebuild.
-- The original inline CHECK was auto-named by Postgres; drop it by that name
-- too so tables created before the split lose the two-provider restriction.
ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_provider_check;
ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_provider_allowed;
ALTER TABLE connections ADD CONSTRAINT connections_provider_allowed
  CHECK (provider IN ('yandex','yandex-direct','yandex-api','google'));

-- Login is independent of revocable data credentials.
CREATE TABLE IF NOT EXISTS login_identities (
  yandex_subject TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_user ON login_identities(user_id);
-- Preserve only actual historical Yandex sign-ins. Client data accounts are not identities.
INSERT INTO login_identities (yandex_subject, user_id, email)
SELECT subject, user_id, account_email FROM connections
WHERE provider = 'yandex' AND is_login_identity = true
ON CONFLICT (yandex_subject) DO NOTHING;

CREATE TABLE IF NOT EXISTS oauth_code_attempts (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  verifier_enc BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_code_attempt_expiry ON oauth_code_attempts(expires_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS allow_token_export BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id) WHERE revoked_at IS NULL;

-- Audit trail: storing third-party refresh tokens is personal data, so every
-- issue/refresh/revoke is recorded.
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  connection_id BIGINT,
  action        TEXT NOT NULL,
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);
`;

let migrated: Promise<void> | null = null;

/** Idempotent; safe to call on every request and on every container start. */
export function ensureSchema(): Promise<void> {
  migrated ??= pool.query(SCHEMA).then(() => undefined);
  return migrated;
}

export async function audit(
  userId: number | null,
  action: string,
  detail: Record<string, unknown> = {},
  connectionId: number | null = null,
): Promise<void> {
  await pool.query(
    "INSERT INTO audit_log (user_id, connection_id, action, detail) VALUES ($1,$2,$3,$4)",
    [userId, connectionId, action, JSON.stringify(detail)],
  );
}
