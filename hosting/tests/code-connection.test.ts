import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
vi.mock('../apps/web/src/lib/redis', () => ({ cacheDel: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn() }));
const enabled = Boolean(process.env.TEST_DATABASE_URL);
let db: typeof import('../apps/web/src/lib/db');
let flow: typeof import('../apps/web/src/lib/oauth/code-connection');
let scopes: readonly string[];
beforeAll(async () => {
  if (!enabled) return;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.OHMY_SEO_MASTER_KEY = '03'.repeat(32);
  process.env.YANDEX_API_CLIENT_ID = 'test-api-client';
  process.env.YANDEX_API_CLIENT_SECRET = 'test-api-secret';
  db = await import('../apps/web/src/lib/db');
  flow = await import('../apps/web/src/lib/oauth/code-connection');
  scopes = (await import('../apps/web/src/lib/providers')).YANDEX_API_SCOPES;
  await db.ensureSchema();
});
afterAll(async () => { vi.unstubAllGlobals(); if (enabled) await db.pool.end(); });
it.skipIf(!enabled)('binds a one-time code to its user, application and PKCE request; preserves multiple accounts', async () => {
  const users = await db.pool.query('INSERT INTO users DEFAULT VALUES RETURNING id');
  const user = Number(users.rows[0].id);
  const other = Number((await db.pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id);
  let expectedChallenge = '';
  let subject = `code-${Date.now()}`;
  const request = vi.fn(async (input: string, init: RequestInit) => {
    if (input.includes('/token')) {
      const body = init.body as URLSearchParams;
      expect(body.get('redirect_uri')).toBe('https://oauth.yandex.ru/verification_code');
      expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(expectedChallenge);
      return new Response(JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, scope: scopes.join(' ') }));
    }
    return new Response(JSON.stringify({ id: subject, login: subject }));
  });
  vi.stubGlobal('fetch', request);
  for (let i = 0; i < 2; i++) {
    subject += `-${i}`;
    const attempt = await flow.beginCodeConnection(user);
    const url = new URL(attempt.url);
    expect(url.searchParams.get('scope')!.split(' ')).toEqual(scopes);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expectedChallenge = url.searchParams.get('code_challenge')!;
    const before = request.mock.calls.length;
    await expect(flow.completeCodeConnection(other, attempt.id, '1234567')).rejects.toThrow('expired_attempt');
    expect(request).toHaveBeenCalledTimes(before);
    await flow.completeCodeConnection(user, attempt.id, ' 1234567 ');
    await expect(flow.completeCodeConnection(user, attempt.id, '1234567')).rejects.toThrow('expired_attempt');
  }
  expect((await db.pool.query("SELECT id FROM connections WHERE user_id=$1 AND provider='yandex-api'", [user])).rowCount).toBe(2);
  const expired = await flow.beginCodeConnection(user);
  await db.pool.query("UPDATE oauth_code_attempts SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.id]);
  await expect(flow.completeCodeConnection(user, expired.id, '1234567')).rejects.toThrow('expired_attempt');
  const changedApp = await flow.beginCodeConnection(user);
  process.env.YANDEX_API_CLIENT_ID = 'other-app';
  await expect(flow.completeCodeConnection(user, changedApp.id, '1234567')).rejects.toThrow('expired_attempt');
  process.env.YANDEX_API_CLIENT_ID = 'test-api-client';
  const failed = await flow.beginCodeConnection(user);
  request.mockImplementationOnce(async () => new Response('sensitive provider detail', { status: 400 }));
  await expect(flow.completeCodeConnection(user, failed.id, '1234567')).rejects.toThrow('exchange_failed');
  await expect(flow.completeCodeConnection(user, failed.id, '1234567')).rejects.toThrow('expired_attempt');
}, 30000);
