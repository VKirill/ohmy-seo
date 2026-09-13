import { afterAll, beforeAll, expect, it, vi } from 'vitest';
vi.mock('../apps/web/src/lib/redis', () => ({ cacheDel: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn() }));
const enabled = Boolean(process.env.TEST_DATABASE_URL);
const suite = it.skipIf(!enabled);
let db: typeof import('../apps/web/src/lib/db');
let connections: typeof import('../apps/web/src/lib/connections');
beforeAll(async () => {
  if (!enabled) return;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.OHMY_SEO_MASTER_KEY = '01'.repeat(32);
  db = await import('../apps/web/src/lib/db');
  connections = await import('../apps/web/src/lib/connections');
  await db.ensureSchema();
});
afterAll(async () => { if (enabled) await db.pool.end(); });
suite('two accounts per provider survive reauthorization, revocation and cross-cabinet attempts', async () => {
  const prefix = Date.now().toString(36);
  const { rows } = await db.pool.query("INSERT INTO users(email) VALUES($1),($2) RETURNING id", [`${prefix}-one@example.test`, `${prefix}-two@example.test`]);
  const userId = Number(rows[0].id), otherId = Number(rows[1].id);
  const tokens = { accessToken: 'test-access', refreshToken: 'test-refresh', expiresInSeconds: 3600, scope: 'test' };
  const ids: number[] = [];
  for (const provider of ['yandex', 'yandex-direct', 'google'] as const) {
    for (const subject of [`${prefix}-first`, `${prefix}-second`]) {
      const identity = { subject, email: `${subject}@example.test`, login: subject, displayName: subject };
      const first = await connections.upsertConnection({ provider, identity, tokens, userId });
      ids.push(first.connectionId);
      const again = await connections.upsertConnection({ provider, identity, tokens: { ...tokens, refreshToken: null }, userId });
      expect(again.connectionId).toBe(first.connectionId);
      expect(await connections.hasStoredRefreshToken(provider, subject)).toBe(true);
      await expect(connections.upsertConnection({ provider, identity, tokens, userId: otherId })).rejects.toThrow('другому кабинету');
    }
  }
  expect(await connections.listConnections(userId)).toHaveLength(6);
  expect(await connections.listConnections(otherId)).toHaveLength(0);
  // Disconnect only the second Yandex account (its two OAuth parts).
  await connections.revokeConnection(userId, ids[1]);
  await connections.revokeConnection(userId, ids[3]);
  const remaining = await connections.listConnections(userId);
  expect(remaining.map(c => c.id)).toEqual([ids[0], ids[2], ids[4], ids[5]]);
}, 30_000);
