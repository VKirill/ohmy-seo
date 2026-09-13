// Run inside the gateway container. Defaults to a read-only verification.
// Apply only after a Postgres backup: APPLY_DIRECT_IDENTITY_MIGRATION=true.
import { Pool } from 'pg';
import { decryptWith, platformKey } from './dist/crypto.js';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rows } = await pool.query("SELECT id, user_id, subject, access_token_enc, updated_at::text AS updated_at FROM connections WHERE provider = 'yandex-direct' AND subject LIKE 'yandex-direct:%' AND revoked_at IS NULL");
  const verified = [];
  for (const row of rows) {
    const token = decryptWith(platformKey(), row.access_token_enc);
    const res = await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: `OAuth ${token}` } });
    if (!res.ok) throw new Error(`Identity lookup failed for connection #${row.id}: HTTP ${res.status}`);
    const identity = await res.json();
    if (!identity.id || !identity.login) throw new Error(`Missing identity for connection #${row.id}`);
    verified.push({ row, identity });
  }
  if (process.env.APPLY_DIRECT_IDENTITY_MIGRATION === 'true') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const { row, identity } of verified) {
        const result = await client.query(`UPDATE connections d SET subject=$1, account_login=$2, label=$2,
          account_email=(SELECT account_email FROM connections WHERE user_id=d.user_id AND provider='yandex' AND subject=$1 AND revoked_at IS NULL),
          updated_at=now()
          WHERE d.id=$3 AND d.subject=$4 AND d.updated_at=$5`, [identity.id, identity.login, row.id, row.subject, row.updated_at]);
        if (result.rowCount !== 1) throw new Error('Concurrent update: retry migration');
        await client.query("INSERT INTO audit_log(user_id, connection_id, action) VALUES($1,$2,'connection.identity_verified')", [row.user_id, row.id]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
  console.log(JSON.stringify({ verified: verified.length, applied: process.env.APPLY_DIRECT_IDENTITY_MIGRATION === 'true' }));
} finally { await pool.end(); }
