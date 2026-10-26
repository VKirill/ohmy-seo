import { afterAll, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A real child over the real SDK stdio transport: the bug lived in how the
// gateway reacts to the transport closing, which mocks of Client cannot show.
// runtime.ts reads these at load, hence the dynamic import below. Real paths:
// node --permission checks the resolved path, and macOS /tmp is a symlink.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'ohmy-respawn-')));
process.env.OHMY_SEO_ROOT = root;
process.env.NODE_BIN = process.execPath;
const tenant = realpathSync(mkdtempSync(join(tmpdir(), 'ohmy-respawn-tenant-')));
vi.mock('../apps/gateway/src/tenant.js', () => ({
  ensureFreshAccounts: async () => [{ provider: 'yandex-api', connectionId: 1, label: 'fixture' }],
  materialize: () => join(tenant, 'state.db'), tenantDir: () => tenant, purgeResponseCache: () => undefined,
}));
vi.mock('../apps/gateway/src/crypto.js', () => ({ tenantKey: () => Buffer.alloc(32, 1) }));

// Minimal MCP server: `mode` decides whether the call answers, crashes the
// process, or answers with a line bigger than the gateway's read buffer.
mkdirSync(join(root, 'packages/yandex-seo/dist'), { recursive: true });
writeFileSync(join(root, 'packages/yandex-seo/dist/index.js'), `
let buf = '';
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (msg.id === undefined) continue;
    if (msg.method === 'initialize') send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } } });
    else if (msg.method === 'tools/list') send({ id: msg.id, result: { tools: [{ name: 'yandex_direct_list_campaigns', inputSchema: { type: 'object', properties: {} } }] } });
    else if (msg.method === 'tools/call') {
      const mode = msg.params.arguments?.mode;
      if (mode === 'exit') process.exit(1);
      const text = mode === 'huge' ? 'x'.repeat(17 * 1024 * 1024) : 'pid=' + process.pid;
      send({ id: msg.id, result: { content: [{ type: 'text', text }] } });
    } else send({ id: msg.id, error: { code: -32601, message: 'no' } });
  }
});
`);

const { callTool, GatewayUserError, shutdownAll } = await import('../apps/gateway/src/runtime');
afterAll(async () => {
  await shutdownAll();
  rmSync(root, { recursive: true, force: true });
  rmSync(tenant, { recursive: true, force: true });
});

const pidOf = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text;
const ok = () => callTool(7, 'yandex_direct_list_campaigns', {});

it('respawns a child that exited, so the next call succeeds', async () => {
  const before = pidOf(await ok());
  expect(before).toMatch(/^pid=\d+$/);
  await expect(callTool(7, 'yandex_direct_list_campaigns', { mode: 'exit' })).rejects.toThrow(GatewayUserError);
  const after = pidOf(await ok());
  expect(after).toMatch(/^pid=\d+$/);
  expect(after).not.toBe(before);
}, 30_000);

it('reports an oversized response clearly and recovers on the next call', async () => {
  const before = pidOf(await ok());
  await expect(callTool(7, 'yandex_direct_list_campaigns', { mode: 'huge' })).rejects.toThrow(/Ответ слишком большой \(больше 16 МБ\)/);
  const after = pidOf(await ok());
  expect(after).not.toBe(before);
}, 30_000);
