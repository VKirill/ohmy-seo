import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptSecret, decryptSecret } from '../apps/web/src/lib/crypto';
import { platformKey, decryptWith } from '../apps/gateway/src/crypto';
const original = process.env.OHMY_SEO_MASTER_KEY_FILE;
afterEach(() => {
  if (original === undefined) delete process.env.OHMY_SEO_MASTER_KEY_FILE;
  else process.env.OHMY_SEO_MASTER_KEY_FILE = original;
});
it('reads existing ciphertext with a mounted key, prefers the file and fails closed on invalid files', () => {
  const key = Buffer.alloc(32, 4);
  const encrypted = encryptSecret('existing-test-token', key);
  const dir = mkdtempSync(join(tmpdir(), 'ohmy-key-test-'));
  const file = join(dir, 'key');
  try {
    writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600 });
    process.env.OHMY_SEO_MASTER_KEY_FILE = file;
    expect(decryptSecret(encrypted)).toBe('existing-test-token');
    expect(decryptWith(platformKey(), encrypted)).toBe('existing-test-token');
    writeFileSync(file, 'invalid');
    expect(() => decryptSecret(encrypted)).toThrow();
    expect(() => platformKey()).toThrow();
  } finally { rmSync(dir, { recursive: true }); }
});
