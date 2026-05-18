import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  parseYandexSerpXml,
  parseGoogleSerpXml,
  parseXmlstockError,
} from '../src/lib/xmlstock-parse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fix = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf-8');

let ok = 0;
let fail = 0;

function run(label: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${label}`);
    ok++;
  } catch (err) {
    console.log(`FAIL  ${label}: ${(err as Error).message}`);
    fail++;
  }
}

// 1. Yandex success
run('yandex-serp-success.xml', () => {
  const serp = parseYandexSerpXml(fix('yandex-serp-success.xml'));
  assert.equal(serp.engine, 'yandex');
  assert.ok(serp.results.length >= 5, `expected >= 5 results, got ${serp.results.length}`);
  for (const r of serp.results) {
    assert.ok(r.url, `result at position ${r.position} has no url`);
    assert.ok(r.title, `result at position ${r.position} has no title`);
  }
  // Regression: hlword content must be preserved in titles
  const hasSEOTitle = serp.results.some(r => /SEO/i.test(r.title));
  assert.ok(hasSEOTitle, 'expected at least one title containing SEO (hlword content preserved)');
  // Regression: hlword content must be preserved in snippets (passages)
  const hasSEOSnippet = serp.results.some(r => r.snippet != null && /SEO/i.test(r.snippet));
  assert.ok(hasSEOSnippet, 'expected at least one snippet containing SEO (hlword content preserved in passages)');
});

// 2. Google success
run('google-serp-success.xml', () => {
  const serp = parseGoogleSerpXml(fix('google-serp-success.xml'));
  assert.equal(serp.engine, 'google');
  assert.ok(serp.results.length >= 5, `expected >= 5 results, got ${serp.results.length}`);
  for (const r of serp.results) {
    assert.ok(r.url, `result at position ${r.position} has no url`);
    assert.ok(r.title, `result at position ${r.position} has no title`);
  }
});

// 3. Error invalid key (-34)
run('error-invalid-key.xml', () => {
  const err = parseXmlstockError(fix('error-invalid-key.xml'));
  assert.ok(err !== null, 'expected an error object, got null');
  assert.equal(err.code, -34);
});

// 4. Error queue (210)
run('error-queue-210.xml', () => {
  const err = parseXmlstockError(fix('error-queue-210.xml'));
  assert.ok(err !== null, 'expected an error object, got null');
  assert.equal(err.code, 210);
});

// 5. Missing favicon — yandex serp without favicons
run('missing-favicon.xml', () => {
  const serp = parseYandexSerpXml(fix('missing-favicon.xml'));
  assert.ok(serp.results.length > 0, 'expected at least 1 result');
  for (const r of serp.results) {
    assert.ok(
      r.favicon === undefined || r.favicon === '',
      `expected favicon to be absent, got: ${r.favicon}`,
    );
  }
});

console.log('');
console.log(`=== ${ok} OK, ${fail} FAIL ===`);
process.exit(fail === 0 ? 0 : 1);
