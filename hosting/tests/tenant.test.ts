import { beforeAll, afterAll, expect, it } from 'vitest';
import Database from '../apps/gateway/node_modules/better-sqlite3/lib/index.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
let tenant: typeof import('../apps/gateway/src/tenant');
beforeAll(async () => {
  process.env.TENANT_ROOT = mkdtempSync(resolve(tmpdir(), 'ohmy-tenant-tests-'));
  process.env.OHMY_SEO_MASTER_KEY = '02'.repeat(32);
  tenant = await import('../apps/gateway/src/tenant');
});
afterAll(async () => { await tenant.pool.end(); });
it('materializes multiple accounts and removes only disconnected accounts, keeping surviving IDs', () => {
  const accounts = ['yandex', 'yandex-direct', 'google'].flatMap((provider, i) => ['first', 'second'].map((label, j) => ({
    connectionId: i * 2 + j + 1, provider, label, login: label, email: `${label}@example.test`,
    accessToken: `test-${provider}-${label}`, expiresAt: new Date(Date.now() + 3600000), scopes: 'test', isDefault: j === 0,
  }))) as import('../apps/gateway/src/tenant').Account[];
  const path = tenant.materialize(10, accounts);
  const db = new Database(path);
  expect(db.prepare('SELECT count(*) AS n FROM accounts').get()).toEqual({ n: 4 });
  expect(db.prepare('SELECT count(*) AS n FROM google_accounts').get()).toEqual({ n: 2 });
  expect(db.prepare('SELECT expires_at FROM google_accounts LIMIT 1').get()).toEqual({ expires_at: Math.floor(accounts[0].expiresAt.getTime() / 1000) });
  const original = db.prepare("SELECT id FROM accounts WHERE label='first'").get();
  tenant.materialize(10, accounts.filter(a => a.label !== 'second'));
  expect(db.prepare('SELECT count(*) AS n FROM accounts').get()).toEqual({ n: 2 });
  expect(db.prepare('SELECT count(*) AS n FROM google_accounts').get()).toEqual({ n: 1 });
  expect(db.prepare("SELECT id FROM accounts WHERE label='first'").get()).toEqual(original);
  tenant.materialize(10, []);
  expect(db.prepare('SELECT count(*) AS n FROM accounts').get()).toEqual({ n: 0 });
  expect(db.prepare('SELECT count(*) AS n FROM google_accounts').get()).toEqual({ n: 0 });
  db.close();
});
