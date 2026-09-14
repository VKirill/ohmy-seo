import { afterAll, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ call: vi.fn(async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] })) }));
vi.mock('../apps/gateway/src/tenant.js', () => ({
  ensureFreshAccounts: async () => [{ provider: 'yandex-api', connectionId: 1, label: 'fixture' }],
  materialize: () => '/tmp/fixture.db', tenantDir: () => '/tmp/fixture',
}));
vi.mock('../apps/gateway/src/crypto.js', () => ({ tenantKey: () => Buffer.alloc(32, 1) }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: class {
  connect = async () => {}; close = async () => {}; callTool = mocks.call;
  async listTools() { return { tools: ['yandex_direct_update_campaign', 'yandex_webmaster_api', 'register_oauth_app'].map(name => ({ name, inputSchema: { type: 'object', properties: {} } })) }; }
} }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: class {} }));
import { callTool, getRuntime, shutdownAll } from '../apps/gateway/src/runtime';
afterAll(shutdownAll);
it('publishes write tools and dispatches confirmed changes, while refusing unconfirmed writes before any child call', async () => {
  const rt = await getRuntime(42);
  expect(rt.tools.map(t => t.name)).toEqual(['yandex_direct_update_campaign', 'yandex_webmaster_api']);
  const direct = { account: 'fixture', campaign_id: 123, confirm: true };
  await callTool(42, 'yandex_direct_update_campaign', direct);
  expect(mocks.call).toHaveBeenLastCalledWith({ name: 'yandex_direct_update_campaign', arguments: direct }, undefined, { timeout: 120000 });
  const webmaster = { endpoint: '/v4/user/1/hosts', method: 'POST', body: { host_url: 'https://example.test/' }, confirm: true, acknowledge_live: 'POST /v4/user/1/hosts' };
  await callTool(42, 'yandex_webmaster_api', webmaster);
  expect(mocks.call).toHaveBeenLastCalledWith({ name: 'yandex_webmaster_api', arguments: webmaster }, undefined, { timeout: 120000 });
  const before = mocks.call.mock.calls.length;
  await expect(callTool(42, 'yandex_webmaster_api', { ...webmaster, confirm: false })).rejects.toThrow('confirm');
  await expect(callTool(42, 'register_oauth_app', {})).rejects.toThrow();
  expect(mocks.call).toHaveBeenCalledTimes(before);
});
