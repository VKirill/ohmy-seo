import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
vi.mock('../apps/web/src/lib/redis', () => ({ cacheDel: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn() }));
const enabled = Boolean(process.env.TEST_DATABASE_URL);
let db: typeof import('../apps/web/src/lib/db');
let login: typeof import('../apps/web/src/lib/login-identities');
let connections: typeof import('../apps/web/src/lib/connections');
beforeAll(async () => {
  if (!enabled) return;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.OHMY_SEO_MASTER_KEY = '01'.repeat(32);
  db = await import('../apps/web/src/lib/db');
  login = await import('../apps/web/src/lib/login-identities');
  connections = await import('../apps/web/src/lib/connections');
  await db.ensureSchema();
});
afterAll(async () => { if (enabled) await db.pool.end(); });
it.skipIf(!enabled)('keeps sign-in stable, concurrent-safe and independent of email and service accounts', async () => {
  const prefix = `login-${Date.now()}`;
  const identity = { subject: prefix, email: `${prefix}@example.test`, displayName: 'Owner', login: prefix };
  const ids = await Promise.all(Array.from({ length: 4 }, () => login.resolveCabinetUser(identity)));
  expect(new Set(ids).size).toBe(1);
  const owner = ids[0];
  expect((await connections.listConnections(owner))).toHaveLength(0);
  const sameEmail = await login.resolveCabinetUser({ ...identity, subject: `${prefix}-different` });
  expect(sameEmail).not.toBe(owner);
  const tokens = { accessToken: 'fake', refreshToken: 'fake', expiresInSeconds: 3600, scope: 'test' };
  const client = { ...identity, subject: `${prefix}-client`, email: `${prefix}-client@example.test` };
  const connection = await connections.upsertConnection({ provider: 'yandex', identity: client, userId: owner, tokens });
  expect((await connections.listConnections(owner))[0].isLoginIdentity).toBe(false);
  expect(await login.resolveCabinetUser(client)).not.toBe(owner);
  await connections.revokeConnection(owner, connection.connectionId);
  expect(await login.resolveCabinetUser(identity)).toBe(owner);
  await expect(connections.upsertConnection({ provider: 'yandex', identity, userId: null as unknown as number, tokens })).rejects.toThrow('unauthorized');
});
it.skipIf(!enabled)('backfills only historical Yandex sign-ins, including revoked ones, idempotently', async () => {
  const prefix = `legacy-${Date.now()}`;
  const owner = Number((await db.pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id);
  for (const [suffix, provider, isLogin] of [['owner','yandex',true], ['client','yandex',false], ['google','google',true]] as const) {
    await db.pool.query(`INSERT INTO connections(user_id,provider,subject,label,access_token_enc,expires_at,scopes_granted,is_login_identity,revoked_at) VALUES($1,$2,$3,$3,$4,now(),'test',$5,now())`, [owner, provider, `${prefix}-${suffix}`, Buffer.from('fake'), isLogin]);
  }
  const source = readFileSync(new URL('../apps/web/src/lib/db.ts', import.meta.url), 'utf8');
  const schema = source.match(/const SCHEMA = `([\s\S]*?)`;/)![1];
  await db.pool.query(schema);
  await db.pool.query(schema);
  const rows = (await db.pool.query('SELECT yandex_subject,user_id FROM login_identities WHERE yandex_subject LIKE $1', [`${prefix}%`])).rows;
  expect(rows).toEqual([{ yandex_subject: `${prefix}-owner`, user_id: String(owner) }]);
  expect(await login.resolveCabinetUser({ subject: `${prefix}-owner`, email: null, displayName: null, login: null })).toBe(owner);
});
