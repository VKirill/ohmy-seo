/**
 * Smoke runner for mcp-ga4.
 * Usage: pnpm --filter @ohmy-seo/ga4 smoke -- --only=cache
 * Requires MCP_GA4_MASTER_KEY in env or .env file.
 */
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const masterKey = process.env.MCP_GA4_MASTER_KEY ?? "";
if (!/^[0-9a-fA-F]{64}$/.test(masterKey)) {
  process.stderr.write(
    "[smoke] FATAL: MCP_GA4_MASTER_KEY missing or invalid.\n" +
    "[smoke] Generate: openssl rand -hex 32\n",
  );
  process.exit(1);
}

import { withCache, registerCacheableTool, countEntries, computeArgsHash } from "@ohmy-seo/mcp-core/cache";
import { getDb } from "@ohmy-seo/mcp-core/db";
import { runListGoogleAccounts } from "./tools/list-google-accounts.js";

const log = (msg: string) => process.stderr.write("[smoke] " + msg + "\n");

let ok = 0;
let fail = 0;

async function run(name: string, fn: () => Promise<unknown>): Promise<void> {
  log(`-> ${name}`);
  try {
    const r = await fn();
    if ((r as { isError?: boolean })?.isError) {
      log("  FAIL: " + JSON.stringify((r as { content?: unknown })?.content));
      fail++;
    } else {
      log("  OK");
      ok++;
    }
  } catch (e: unknown) {
    log("  FAIL: " + (e instanceof Error ? e.message : String(e)).slice(0, 200));
    fail++;
  }
}

async function runListAccountsEmpty(): Promise<void> {
  log("--- group: list_accounts_empty ---");
  await run("list_google_accounts returns array", async () => {
    const result = await runListGoogleAccounts();
    const text = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as { accounts?: unknown[] };
    log(`  accounts.length=${parsed.accounts?.length ?? 0}`);
    return result;
  });
}

async function runCache(): Promise<void> {
  log("--- group: cache ---");
  const TOOL = "ga4_run_report";
  registerCacheableTool(TOOL, { ttlEnvKey: "MCP_GA4_CACHE_TTL_REPORT", ttlDefaultSeconds: 3600 });

  const ARGS = { property: "properties/smoke-123", dimensions: [{ name: "date" }] };
  const RES = { smoke: true };

  // Pre-clean: delete this test's specific cache entry so the test is idempotent
  // across consecutive runs (TTL is 1h; without this the "first call" would be a hit).
  const testHash = computeArgsHash(TOOL, null, ARGS);
  getDb().prepare("DELETE FROM query_cache WHERE args_hash = ?").run(testHash);

  await run("cache:first-call-writes-entry", async () => {
    let n = 0;
    await withCache({ toolName: TOOL, accountId: null, args: ARGS, forceRefresh: false },
      async () => { n++; return RES; });
    if (n !== 1) throw new Error(`expected 1 upstream call, got ${n}`);
    return { content: [{ type: "text" as const, text: "written" }] };
  });

  await run("cache:total-entries-gt-zero", async () => {
    const total = countEntries();
    if (total < 1) throw new Error(`total_entries=${total}`);
    log(`  total_entries=${total}`);
    return { content: [{ type: "text" as const, text: String(total) }] };
  });

  await run("cache:second-call-is-hit", async () => {
    let n = 0;
    await withCache({ toolName: TOOL, accountId: null, args: ARGS, forceRefresh: false },
      async () => { n++; return RES; });
    if (n !== 0) throw new Error(`expected 0 upstream calls, got ${n}`);
    return { content: [{ type: "text" as const, text: "hit" }] };
  });

  await run("cache:force-refresh-rewrites", async () => {
    let n = 0;
    await withCache({ toolName: TOOL, accountId: null, args: ARGS, forceRefresh: true },
      async () => { n++; return { ...RES, refreshed: true }; });
    if (n !== 1) throw new Error(`expected 1 upstream call, got ${n}`);
    return { content: [{ type: "text" as const, text: "refreshed" }] };
  });
}

async function main(): Promise<void> {
  const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "all";
  const valid = ["list_accounts_empty", "cache", "all"];
  if (!valid.includes(only)) {
    log(`ERROR: unknown --only="${only}". Valid: ${valid.join(", ")}`);
    process.exit(1);
  }
  log(`start only=${only}`);
  if (only === "list_accounts_empty" || only === "all") await runListAccountsEmpty();
  if (only === "cache" || only === "all") await runCache();
  log(`\n=== ${ok} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  log("FATAL: " + (e instanceof Error ? e.message : String(e)).slice(0, 200));
  process.exit(1);
});
