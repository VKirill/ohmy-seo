import { afterAll, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fresh: vi.fn(), materialize: vi.fn(() => '/tmp/test-state.db'), connect: vi.fn(), close: vi.fn(async () => {}) }));
vi.mock('../apps/gateway/src/tenant.js', () => ({ ensureFreshAccounts: mocks.fresh, materialize: mocks.materialize, tenantDir: () => '/tmp/test-tenant' }));
vi.mock('../apps/gateway/src/crypto.js', () => ({ tenantKey: () => Buffer.alloc(32, 1) }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: class {
  connect = mocks.connect; close = mocks.close;
  async listTools() { return { tools: [] }; }
} }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: class {} }));
import { getRuntime, shutdownAll } from '../apps/gateway/src/runtime';
afterAll(async () => { await shutdownAll(); });
it('refreshes active MCP runtimes after account additions/removals, without reissuing API keys', async () => {
  const a = { provider: 'yandex', connectionId: 1, label: 'first' };
  mocks.fresh.mockResolvedValue([a]);
  const initial = await getRuntime(10);
  expect(initial.clients.size).toBe(1);
  mocks.fresh.mockResolvedValue([a, { provider: 'google', connectionId: 2, label: 'second' }]);
  const [updated, concurrent] = await Promise.all([getRuntime(10), getRuntime(10)]);
  expect(updated).toBe(concurrent);
  expect(updated).not.toBe(initial);
  expect(updated.clients.size).toBe(4);
  expect(mocks.close).toHaveBeenCalledTimes(1);
  mocks.fresh.mockResolvedValue([]);
  const empty = await getRuntime(10);
  expect(empty.clients.size).toBe(0);
  expect(mocks.materialize).toHaveBeenLastCalledWith(10, []);
  expect(mocks.close).toHaveBeenCalledTimes(5);
});
it('starts the Yandex MCP server for a unified API-only connection', async () => {
  mocks.fresh.mockResolvedValue([{ provider: 'yandex-api', connectionId: 3, label: 'api-account' }]);
  const rt = await getRuntime(20);
  expect([...rt.clients.keys()]).toEqual(['yandex-seo']);
});
