/**
 * Smoke runner for @ohmy-seo/mutagen.
 * Output goes to stderr only (safe for MCP stdio).
 *
 * Usage:
 *   pnpm smoke                     # all groups
 *   pnpm smoke -- --only=cache     # cache group only (no external API)
 *   pnpm smoke -- --only=mutagen   # requires SMOKE_MUTAGEN=1 + MUTAGEN_API_KEY
 *
 * Required env: MCP_MUTAGEN_MASTER_KEY (always)
 * mutagen group also requires: SMOKE_MUTAGEN=1, MUTAGEN_API_KEY
 */

import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

dotenvConfig({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
});

// ---------------------------------------------------------------------------
// Fail-fast: master key must be present before any DB/crypto import
// ---------------------------------------------------------------------------

const masterKey = process.env.MCP_MUTAGEN_MASTER_KEY ?? "";
if (!/^[0-9a-fA-F]{64}$/.test(masterKey)) {
  process.stderr.write(
    "[smoke] FATAL: MCP_MUTAGEN_MASTER_KEY is missing or invalid.\n" +
    "[smoke] Generate with: openssl rand -hex 32\n" +
    "[smoke] Then add to packages/mutagen/.env: MCP_MUTAGEN_MASTER_KEY=<value>\n",
  );
  process.exit(1);
}

import { withCache, countEntries, computeArgsHash } from "@ohmy-seo/mcp-core/cache";
import { getDb } from "@ohmy-seo/mcp-core/db";
import { runMutagenCompetition } from "./tools/mutagen-competition.js";

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
  const TOOL = "mutagen_competition";
  const FAKE_ARGS = { phrases: ["smoke-test-keyword"] };
  const FAKE_ACC_ID = null;
  const FAKE_RESULT = { smoke: true };

  // Pre-clean: delete this test's specific cache entry so the test is idempotent
  // across consecutive runs (TTL is 30d; without this the "first call" would be a hit).
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
// mutagen group — real API call, gated behind SMOKE_MUTAGEN=1
// ---------------------------------------------------------------------------

async function runMutagen(): Promise<void> {
  log("--- group: mutagen ---");
  if (process.env.SMOKE_MUTAGEN !== "1") {
    log("  SKIP: set SMOKE_MUTAGEN=1 to enable (makes real Mutagen API calls, costs balance)");
    return;
  }
  if (!process.env.MUTAGEN_API_KEY) {
    log("  SKIP: MUTAGEN_API_KEY not set");
    return;
  }
  await run("mutagen:competition phrase=seo limit=1", () =>
    runMutagenCompetition({ phrases: ["seo"], poll_timeout_sec: 60 }),
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const only =
    process.argv.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "all";

  const validValues = ["cache", "mutagen", "all"];
  if (!validValues.includes(only)) {
    log(`ERROR: unknown --only value "${only}". Valid: ${validValues.join(", ")}`);
    process.exit(1);
  }

  log(`start only=${only}`);

  if (only === "cache" || only === "all") await runCache();
  if (only === "mutagen" || only === "all") await runMutagen();

  log(`\n=== ${ok} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : ok > 0 ? 0 : 0);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  log("FATAL: " + msg.slice(0, 200));
  process.exit(1);
});
