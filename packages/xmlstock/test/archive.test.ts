/**
 * archive.test.ts — integration tests for xmlstock-archive helpers.
 *
 * Uses a temp DB so it never touches production state.db.
 */

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Point archive to a temp DB before importing the module
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xmlstock-archive-test-"));
process.env.MCP_XMLSTOCK_DB_PATH = path.join(tmpDir, "test.db");

import { archiveRawXml, searchArchive, getArchivedXml } from "../src/lib/xmlstock-archive.js";

let ok = 0;
let fail = 0;

async function run(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${label}`);
    ok++;
  } catch (err) {
    console.log(`FAIL  ${label}: ${(err as Error).message}`);
    fail++;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const SAMPLE_XML = '<?xml version="1.0"?><test/>';
const CANONICAL = { query: "archive-test-key-xyz", engine: "yandex", page: 0 };

await run("archiveRawXml: inserts a row", async () => {
  await archiveRawXml("yandex", CANONICAL, SAMPLE_XML, 200);
});

await run("searchArchive: finds row by query substring", async () => {
  const found = await searchArchive({ query: "archive-test-key-xyz", limit: 1 });
  assert.ok(found.length >= 1, "search must find the row");
  assert.equal(found[0].engine, "yandex");
  assert.equal(found[0].http_status, 200);
  assert.ok(found[0].raw_size_bytes > 0);
});

await run("getArchivedXml: roundtrip preserves XML byte-for-byte", async () => {
  const found = await searchArchive({ query: "archive-test-key-xyz", limit: 1 });
  assert.ok(found.length >= 1, "search must find the row");
  const fetched = await getArchivedXml(found[0].id);
  assert.ok(fetched !== null, "must return a record");
  assert.equal(fetched.raw_xml, SAMPLE_XML, "roundtrip must preserve XML byte-for-byte");
  assert.equal(fetched.engine, "yandex");
});

await run("getArchivedXml: returns null for missing id", async () => {
  const result = await getArchivedXml(999999);
  assert.equal(result, null);
});

await run("searchArchive: engine filter excludes non-matching rows", async () => {
  const found = await searchArchive({ query: "archive-test-key-xyz", engine: "google", limit: 10 });
  assert.equal(found.length, 0, "google filter should exclude yandex rows");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== ${ok + fail} tests: ${ok} OK, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
