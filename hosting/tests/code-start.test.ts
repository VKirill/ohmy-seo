import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server.js';
const mocks = vi.hoisted(() => ({ user: vi.fn(), begin: vi.fn() }));
vi.mock('@/lib/session', () => ({ currentUser: mocks.user }));
vi.mock('@/lib/oauth/code-connection', () => ({ beginCodeConnection: mocks.begin }));
import { POST } from '../apps/web/src/app/api/oauth/yandex-code/start/route';
beforeEach(() => {
  vi.clearAllMocks(); process.env.APP_URL = 'https://test.invalid';
  mocks.user.mockResolvedValue({ id: 10 });
  mocks.begin.mockResolvedValue({ id: 'a'.repeat(48), url: 'https://oauth.yandex.ru/authorize?response_type=code' });
});
it('starts code authorization via native POST with session cookie and 303', async () => {
  const r = await POST(new NextRequest('https://test.invalid/api/oauth/yandex-code/start', { method: 'POST', headers: { origin: 'https://test.invalid' } }));
  expect(r.status).toBe(303);
  expect(r.headers.get('location')).toContain('oauth.yandex.ru/authorize');
  expect(r.headers.get('set-cookie')).toContain('Path=/app/connect');
  expect(r.headers.get('set-cookie')).toContain('HttpOnly');
  expect(mocks.begin).toHaveBeenCalledWith(10);
});
it('rejects cross-origin posts before starting an attempt', async () => {
  for (const origin of ['', 'https://attacker.invalid']) {
    const r = await POST(new NextRequest('https://test.invalid/api/oauth/yandex-code/start', { method: 'POST', headers: { origin } }));
    expect(r.status).toBe(403);
  }
  expect(mocks.begin).not.toHaveBeenCalled();
});
it('requires an authenticated cabinet', async () => {
  mocks.user.mockResolvedValue(null);
  const r = await POST(new NextRequest('https://test.invalid/api/oauth/yandex-code/start', { method: 'POST', headers: { origin: 'https://test.invalid' } }));
  expect(r.headers.get('location')).toBe('https://test.invalid/');
  expect(mocks.begin).not.toHaveBeenCalled();
});
