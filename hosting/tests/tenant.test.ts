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
it('keeps unified API credentials separate from legacy Yandex credentials', () => {
  const common = { label: 'same', login: 'same', email: null, accessToken: 'test-token', expiresAt: new Date(Date.now()+3600000), scopes: 'test', isDefault: false };
  const path = tenant.materialize(20, [{ ...common, provider: 'yandex', connectionId: 1 }, { ...common, provider: 'yandex-api', connectionId: 2 }]);
  const db = new Database(path);
  expect(db.prepare('SELECT label FROM accounts ORDER BY label').all()).toEqual([{ label: 'same' }, { label: 'same (API)' }]);
  tenant.materialize(20, [{ ...common, provider: 'yandex-api', connectionId: 2 }]);
  expect(db.prepare('SELECT label FROM accounts').all()).toEqual([{ label: 'same (API)' }]);
  db.close();
});
it('drops expired cached responses and the whole cache after a disconnect', () => {
  const common = { login: 'c', email: 'c@example.test', accessToken: 'test-token', expiresAt: new Date(Date.now() + 3600000), scopes: 'test', isDefault: false };
  const accounts = [{ ...common, label: 'one', provider: 'google', connectionId: 1 }, { ...common, label: 'two', provider: 'google', connectionId: 2 }] as import('../apps/gateway/src/tenant').Account[];
  const path = tenant.materialize(30, accounts);
  const db = new Database(path);
  db.exec('CREATE TABLE IF NOT EXISTS query_cache (args_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO query_cache VALUES (?,?),(?,?)').run('old', now - 10, 'fresh', now + 3600);
  tenant.materialize(30, accounts);
  expect(db.prepare('SELECT args_hash FROM query_cache').all()).toEqual([{ args_hash: 'fresh' }]);
  tenant.materialize(30, accounts.slice(0, 1));
  expect(db.prepare('SELECT count(*) AS n FROM query_cache').get()).toEqual({ n: 0 });
  db.prepare('INSERT INTO query_cache VALUES (?,?)').run('idle', now + 3600);
  tenant.purgeResponseCache(30);
  expect(db.prepare('SELECT count(*) AS n FROM query_cache').get()).toEqual({ n: 0 });
  db.close();
});
