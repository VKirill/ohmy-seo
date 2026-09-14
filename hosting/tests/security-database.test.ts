import { afterAll, beforeAll, expect, it, vi } from 'vitest';
const cache = vi.hoisted(() => ({ cacheGet: vi.fn(), cacheSet: vi.fn(), cacheDel: vi.fn() }));
vi.mock('../apps/web/src/lib/redis', () => cache);
const enabled = Boolean(process.env.TEST_DATABASE_URL);
const suite = it.skipIf(!enabled);
let db: typeof import('../apps/web/src/lib/db');
let keys: typeof import('../apps/web/src/lib/apikey');
let connections: typeof import('../apps/web/src/lib/connections');
beforeAll(async () => {
  if (!enabled) return;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.OHMY_SEO_MASTER_KEY = '03'.repeat(32);
  db = await import('../apps/web/src/lib/db'); keys = await import('../apps/web/src/lib/apikey');
  connections = await import('../apps/web/src/lib/connections'); await db.ensureSchema();
});
afterAll(async () => { if (enabled) await db.pool.end(); });
suite('separates export permission, denies SQL-shaped keys and cannot revoke another user key', async () => {
  const users = await db.pool.query('INSERT INTO users DEFAULT VALUES RETURNING id');
  const other = await db.pool.query('INSERT INTO users DEFAULT VALUES RETURNING id');
  const uid = Number(users.rows[0].id), oid = Number(other.rows[0].id);
  const plain = await keys.createApiKey(uid, 'cloud');
  const req = (value: string) => new Request('https://example.test', { headers: { Authorization: `Bearer ${value}` } });
  expect(await keys.authenticateApiKey(req("'OR'1'='1"))).toBeNull();
  const owner = (await keys.authenticateApiKey(req(plain)))!;
  expect(owner).toMatchObject({ userId: uid, allowTokenExport: false });
  await keys.revokeApiKey(oid, owner.keyId); expect(await keys.authenticateApiKey(req(plain))).not.toBeNull();
  await keys.revokeApiKey(uid, owner.keyId); expect(await keys.authenticateApiKey(req(plain))).toBeNull();
  const exportKey = await keys.createApiKey(uid, 'local', true);
  expect(await keys.authenticateApiKey(req(exportKey))).toMatchObject({ allowTokenExport: true });
});
suite('rejects cross-user token lookup and encrypts Redis values, ignoring legacy plaintext cache', async () => {
  const u = await db.pool.query('INSERT INTO users DEFAULT VALUES RETURNING id'); const uid = Number(u.rows[0].id);
  const accessToken = 'test-secret-token-never-in-redis';
  const c = await connections.upsertConnection({ userId: uid, provider: 'yandex',
    identity: { subject: `security-${uid}`, email: null, login: 'test', displayName: 'test' },
    tokens: { accessToken, refreshToken: null, scope: 'test', expiresInSeconds: 3600 } });
  await expect(connections.accessTokenFor(uid + 100000, c.connectionId)).rejects.toThrow('connection not found');
  cache.cacheGet.mockResolvedValue(JSON.stringify({ t: 'stale-unencrypted-secret', e: Date.now() + 3600000 }));
  expect((await connections.accessTokenFor(uid, c.connectionId)).accessToken).toBe(accessToken);
  const stored = cache.cacheSet.mock.calls.at(-1)![1];
  expect(stored).not.toContain(accessToken); expect(JSON.parse(stored).enc).toBeTypeOf('string');
  cache.cacheGet.mockResolvedValue(stored);
  expect((await connections.accessTokenFor(uid, c.connectionId)).accessToken).toBe(accessToken);
  await connections.revokeConnection(uid, c.connectionId);
  await expect(connections.accessTokenFor(uid, c.connectionId)).rejects.toThrow('connection not found');
});
