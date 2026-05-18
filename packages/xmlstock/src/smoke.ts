/**
 * Smoke runner for @ohmy-seo/xmlstock.
 * Output goes to stderr only (safe for MCP stdio).
 *
 * Usage:
 *   pnpm smoke                        # all groups
 *   pnpm smoke -- --only=cache        # cache group only (no external API)
 *   pnpm smoke -- --only=fixtures     # parser fixture tests (offline)
 *   pnpm smoke -- --only=xmlstock     # requires SMOKE_XMLSTOCK_SPEND_OK=1 + XMLSTOCK_USER + XMLSTOCK_KEY
 *   pnpm smoke -- --help
 *
 * Required env: MCP_XMLSTOCK_MASTER_KEY (always)
 * xmlstock group also requires: SMOKE_XMLSTOCK_SPEND_OK=1, XMLSTOCK_USER, XMLSTOCK_KEY
 */

import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

dotenvConfig({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
});

// ---------------------------------------------------------------------------
// Fail-fast: master key must be present before any DB/crypto import
// ---------------------------------------------------------------------------

const masterKey = process.env.MCP_XMLSTOCK_MASTER_KEY ?? "";
if (!/^[0-9a-fA-F]{64}$/.test(masterKey)) {
  process.stderr.write(
    "[smoke] FATAL: MCP_XMLSTOCK_MASTER_KEY is missing or invalid.\n" +
    "[smoke] Generate with: openssl rand -hex 32\n" +
    "[smoke] Then add to packages/xmlstock/.env: MCP_XMLSTOCK_MASTER_KEY=<value>\n",
  );
  process.exit(1);
}

import { withCache, countEntries, computeArgsHash } from "@ohmy-seo/mcp-core/cache";
import { getDb } from "@ohmy-seo/mcp-core/db";
import { runXmlstockYandexSerp } from "./tools/xmlstock-yandex-serp.js";
import { runXmlstockGoogleSerp } from "./tools/xmlstock-google-serp.js";
import { runXmlstockUsageStats } from "./tools/xmlstock-usage-stats.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const log = (msg: string): void => {
  process.stderr.write("[smoke] " + msg + "\n");
};

function previewText(result: unknown): string {
  const r = result as { content?: Array<{ text?: string }> };
  const text = r?.content?.[0]?.text ?? "";
  return text.slice(0, 200).replace(/\n/g, " ");
}

function isError(result: unknown): boolean {
  return !!(result as { isError?: boolean })?.isError;
}

let ok = 0;
let fail = 0;

async function run(name: string, fn: () => Promise<unknown>): Promise<void> {
  log(`→ ${name}`);
  try {
    const result = await fn();
    if (isError(result)) {
      const content = (result as { content?: unknown })?.content;
      log(`  FAIL: ${JSON.stringify(content)}`);
      fail++;
    } else {
      log("  OK");
      log("  preview: " + previewText(result));
      ok++;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log("  FAIL (thrown): " + msg.slice(0, 200));
    fail++;
  }
}

// ---------------------------------------------------------------------------
// cache group — offline, uses mcp-core cache directly, no external API
// ---------------------------------------------------------------------------

async function runCache(): Promise<void> {
  log("--- group: cache ---");
  const TOOL = "xmlstock_yandex_serp";
  const FAKE_ARGS = { query: "smoke-test-query", lr: 213 };
  const FAKE_ACC_ID = null;
  const FAKE_RESULT = { smoke: true };

  // Pre-clean: delete this test's specific cache entry so the test is idempotent
  // across consecutive runs (TTL is 24h; without this the "first call" would be a hit).
  const testHash = computeArgsHash(TOOL, FAKE_ACC_ID, FAKE_ARGS);
  getDb().prepare("DELETE FROM query_cache WHERE args_hash = ?").run(testHash);

  // First call: writes an entry
  await run("cache:first-call-writes-entry", async () => {
    let callCount = 0;
    await withCache(
      { toolName: TOOL, accountId: FAKE_ACC_ID, args: FAKE_ARGS, forceRefresh: false },
      async () => { callCount++; return FAKE_RESULT; },
    );
    if (callCount !== 1) throw new Error(`expected 1 upstream call, got ${callCount}`);
    return { content: [{ type: "text" as const, text: "entry written" }] };
  });

  // Stats: total_entries > 0
  await run("cache:entries-gt-zero", async () => {
    const total = countEntries();
    if (total < 1) throw new Error(`total_entries=${total}, expected >= 1`);
    log(`  total_entries=${total}`);
    return { content: [{ type: "text" as const, text: `total_entries=${total}` }] };
  });

  // Second call: cache hit, upstream not called
  await run("cache:second-call-is-hit", async () => {
    let callCount = 0;
    await withCache(
      { toolName: TOOL, accountId: FAKE_ACC_ID, args: FAKE_ARGS, forceRefresh: false },
      async () => { callCount++; return FAKE_RESULT; },
    );
    if (callCount !== 0) throw new Error(`expected 0 upstream calls (cache hit), got ${callCount}`);
    return { content: [{ type: "text" as const, text: "cache hit confirmed" }] };
  });

  // force_refresh: upstream re-called
  await run("cache:force-refresh-rewrites-entry", async () => {
    let callCount = 0;
    await withCache(
      { toolName: TOOL, accountId: FAKE_ACC_ID, args: FAKE_ARGS, forceRefresh: true },
      async () => { callCount++; return { ...FAKE_RESULT, refreshed: true }; },
    );
    if (callCount !== 1) throw new Error(`expected 1 upstream call (force refresh), got ${callCount}`);
    return { content: [{ type: "text" as const, text: "force refresh ok" }] };
  });
}

// ---------------------------------------------------------------------------
// fixtures group — runs parser tests via subprocess, no external API calls
// ---------------------------------------------------------------------------

async function runFixtures(): Promise<void> {
  log("--- group: fixtures ---");
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const testFile = resolve(pkgRoot, "test/parse.test.ts");

  await run("fixtures:parse.test.ts", async () => {
    const proc = spawnSync("tsx", [testFile], {
      cwd: pkgRoot,
      encoding: "utf-8",
      env: process.env,
    });
    const combined = (proc.stdout ?? "") + (proc.stderr ?? "");
    if (proc.status !== 0) {
      throw new Error(`parse.test.ts exited ${proc.status}:\n${combined.slice(0, 400)}`);
    }
    log("  output: " + combined.replace(/\n/g, " ").slice(0, 200));
    return { content: [{ type: "text" as const, text: combined.slice(0, 200) }] };
  });
}

// ---------------------------------------------------------------------------
// xmlstock group — PAID API CALLS, gated behind spend env
// ---------------------------------------------------------------------------

const MAX_PAID_CALLS = 2;

async function runXmlstock(): Promise<void> {
  log("--- group: xmlstock ---");

  if (
    process.env.SMOKE_XMLSTOCK_SPEND_OK !== "1" ||
    !process.env.XMLSTOCK_USER ||
    !process.env.XMLSTOCK_KEY
  ) {
    log("SKIP xmlstock group — requires SMOKE_XMLSTOCK_SPEND_OK=1 + XMLSTOCK_USER + XMLSTOCK_KEY");
    return;
  }

  log("WARNING: this consumes ~2 paid XMLStock credits (~0.04 RUB)");

  let calls = 0;

  await run("xmlstock:yandex_serp query=seo lr=213", async () => {
    const result = await runXmlstockYandexSerp({ query: "seo", lr: 213, groupby: 10, force_refresh: false });
    calls++;
    return result;
  });

  await run("xmlstock:google_serp query=seo hl=en", async () => {
    const result = await runXmlstockGoogleSerp({ query: "seo", hl: "en", page: 0, force_refresh: false });
    calls++;
    return result;
  });

  if (calls !== MAX_PAID_CALLS) {
    log(`  FAIL: expected ${MAX_PAID_CALLS} paid calls, executed ${calls}`);
    fail++;
  } else {
    log(`  paid calls executed: ${calls} / ${MAX_PAID_CALLS}`);
  }

  // Verify usage stats reflect the calls
  await run("xmlstock:usage_stats after paid calls", async () => {
    const result = await runXmlstockUsageStats();
    return result;
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help")) {
    process.stderr.write(
      "Usage: pnpm smoke [-- --only=<group>] [--help]\n" +
      "Groups: cache, fixtures, xmlstock, all (default)\n" +
      "  cache     — tests mcp-core cache hit/miss/force-refresh (no API calls)\n" +
      "  fixtures  — runs parser tests against 5 XML fixture files (offline)\n" +
      "  xmlstock  — paid API calls; requires SMOKE_XMLSTOCK_SPEND_OK=1 + XMLSTOCK_USER + XMLSTOCK_KEY\n",
    );
    process.exit(0);
  }

  const only = args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "all";
  const validValues = ["cache", "fixtures", "xmlstock", "all"];

  if (!validValues.includes(only)) {
    log(`ERROR: unknown --only value "${only}". Valid: ${validValues.join(", ")}`);
    process.exit(1);
  }

  log(`start only=${only}`);

  if (only === "cache"    || only === "all") await runCache();
  if (only === "fixtures" || only === "all") await runFixtures();
  if (only === "xmlstock" || only === "all") await runXmlstock();

  log(`\n=== ${ok} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : ok > 0 ? 0 : 0);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  log("FATAL: " + msg.slice(0, 200));
  process.exit(1);
});
