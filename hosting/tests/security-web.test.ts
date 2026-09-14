import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server.js';
const mocks = vi.hoisted(() => ({ owner: vi.fn(), token: vi.fn(), list: vi.fn(), cookies: vi.fn(), user: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/apikey', () => ({ authenticateApiKey: mocks.owner, createApiKey: mocks.create, revokeApiKey: vi.fn() }));
vi.mock('@/lib/connections', () => ({ accessTokenFor: mocks.token, listConnections: mocks.list, revokeConnection: vi.fn() }));
vi.mock('@/lib/session', () => ({ currentUser: mocks.user }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.cookies }) }));
vi.mock('@/lib/db', () => ({ audit: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { GET as bundle } from '../apps/web/src/app/api/v1/bundle/route';
import { POST as token } from '../apps/web/src/app/api/v1/connections/[id]/token/route';
import { actionCreateKey } from '../apps/web/src/lib/actions';
import { proxy } from '../apps/web/src/proxy';
beforeEach(() => { vi.clearAllMocks(); });
it('denies token export before loading credentials, including with a valid cloud key', async () => {
  const req = new Request('https://example.test/api/v1/bundle');
  for (const owner of [null, { userId: 1, allowTokenExport: false }]) {
    mocks.owner.mockResolvedValue(owner);
    expect((await bundle(req)).status).toBe(owner ? 403 : 401);
    expect((await token(req, { params: Promise.resolve({ id: '1' }) })).status).toBe(owner ? 403 : 401);
  }
  expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.token).not.toHaveBeenCalled();
});
it('passes the authenticated owner to credential lookup when export is granted', async () => {
  mocks.owner.mockResolvedValue({ userId: 7, allowTokenExport: true });
  mocks.token.mockResolvedValue({ accessToken: 'test', expiresAt: new Date(), provider: 'yandex' });
  expect((await token(new Request('https://example.test/'), { params: Promise.resolve({ id: '99' }) })).status).toBe(200);
  expect(mocks.token).toHaveBeenCalledWith(7, 99);
});
it('uses an HttpOnly cookie and requires explicit opt-in to issue an export key', async () => {
  mocks.user.mockResolvedValue({ id: 7 }); mocks.create.mockResolvedValue('test-key');
  const form = new FormData(); form.set('name', 'MCP');
  await actionCreateKey(form); expect(mocks.create).toHaveBeenLastCalledWith(7, 'MCP', false);
  expect(mocks.cookies).toHaveBeenCalledWith('ohmy_new_key', 'test-key', expect.objectContaining({ httpOnly: true }));
  form.set('allow_token_export', 'on'); await actionCreateKey(form);
  expect(mocks.create).toHaveBeenLastCalledWith(7, 'MCP', true);
});
it('generates a new CSP nonce per cabinet request and prevents caching', () => {
  const req = new NextRequest('https://example.test/app', { headers: { 'x-nonce': 'attacker' } });
  const a = proxy(req), b = proxy(req);
  const csp = a.headers.get('content-security-policy')!;
  expect(csp).toContain("'strict-dynamic'"); expect(csp).not.toContain('attacker');
  expect(csp).not.toBe(b.headers.get('content-security-policy'));
  expect(csp.split(';').find(s => s.trim().startsWith('script-src'))).not.toContain('unsafe-inline');
  expect(a.headers.get('cache-control')).toContain('no-store');
});
