import { pool, ensureSchema } from './db';
import type { Identity } from './oauth';

/** Authentication identity is separate from data connections, and stores no tokens. */
export async function resolveCabinetUser(identity: Identity): Promise<number> {
  if (!identity.subject) throw new Error('Missing login identity');
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize first sign-ins of the same subject; never link users by email.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`login:yandex:${identity.subject}`]);
    const existing = await client.query<{ user_id: string }>(
      'SELECT user_id FROM login_identities WHERE yandex_subject = $1', [identity.subject]);
    let userId: number;
    if (existing.rows[0]) {
      userId = Number(existing.rows[0].user_id);
    } else {
      const created = await client.query<{ id: string }>(
        `INSERT INTO users (email, display_name, last_login_at) VALUES ($1,$2,now())
         ON CONFLICT (email) DO NOTHING RETURNING id`, [identity.email, identity.displayName]);
      // Matching email is not proof of account ownership. Keep that other user intact.
      const row = created.rows[0] ?? (await client.query<{ id: string }>(
        'INSERT INTO users (display_name, last_login_at) VALUES ($1,now()) RETURNING id',
        [identity.displayName])).rows[0];
      userId = Number(row.id);
      await client.query(
        'INSERT INTO login_identities (yandex_subject, user_id, email) VALUES ($1,$2,$3)',
        [identity.subject, userId, identity.email]);
    }
    await client.query('UPDATE users SET display_name = COALESCE($2, display_name), last_login_at = now() WHERE id = $1',
      [userId, identity.displayName]);
    await client.query('UPDATE login_identities SET email = $2 WHERE yandex_subject = $1', [identity.subject, identity.email]);
    await client.query('COMMIT');
    return userId;
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}
