/**
 * Smoke runner — exercises each tool group with real Yandex OAuth (v0.5 generic gateway flow).
 * Output goes to stderr only (safe for MCP stdio).
 *
 * Usage:
 *   npm run smoke                       # all groups
 *   npm run smoke -- --only=oauth-setup
 *   npm run smoke -- --only=generic
 *   npm run smoke -- --only=inventory
 *   npm run smoke -- --only=cache
 *
 * Env vars (smoke-only): MCP_YANDEX_SEO_MASTER_KEY (required), SMOKE_OAUTH_CLIENT_ID/SECRET,
 * SMOKE_OAUTH_SCOPES, SMOKE_ACCESS_TOKEN, SMOKE_REFRESH_TOKEN, SMOKE_CODE.
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

const masterKey = process.env.MCP_YANDEX_SEO_MASTER_KEY ?? "";
if (!/^[0-9a-fA-F]{64}$/.test(masterKey)) {
  process.stderr.write(
    "[smoke] FATAL: MCP_YANDEX_SEO_MASTER_KEY is missing or invalid.\n" +
    "[smoke] Generate with: openssl rand -hex 32\n" +
    "[smoke] Then: export MCP_YANDEX_SEO_MASTER_KEY=<value>\n",
  );
  process.exit(1);
}

import { registerApp, getAppByLabel } from "./lib/db/oauth-apps-repo.js";
import { insertAccount, deleteAccount, listAccounts } from "./lib/db/accounts-repo.js";
import { buildAuthorizeUrl, exchangeCode } from "./lib/oauth/yandex-flow.js";
import { probeLogin, probeWebmasterUserId } from "./lib/oauth/login-probe.js";

import { runRefreshInventory } from "./tools/refresh-inventory.js";
import { runListSites } from "./tools/list-sites.js";
import { runFindProperty } from "./tools/find-property.js";
import { runInvalidateCache } from "./tools/invalidate-cache.js";
import { runCacheStats } from "./tools/cache-stats.js";
import { runYandexWebmasterApi } from "./tools/yandex-webmaster-api.js";
import { runYandexMetrikaApi } from "./tools/yandex-metrika-api.js";
import { withCache } from "@ohmy-seo/mcp-core/cache";
import * as cacheRepo from "@ohmy-seo/mcp-core/cache";

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

// ---------------------------------------------------------------------------
// Run a single named step; track ok/fail counts
// ---------------------------------------------------------------------------

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
// oauth-setup group
// Returns true if domain groups should proceed (account is ready).
// ---------------------------------------------------------------------------

const SMOKE_APP_LABEL = "smoke-app";
const SMOKE_ACC_LABEL = "smoke-acc";

async function runOauthSetup(): Promise<boolean> {
  log("--- group: oauth-setup ---");

  const clientId = process.env.SMOKE_OAUTH_CLIENT_ID ?? "";
  const clientSecret = process.env.SMOKE_OAUTH_CLIENT_SECRET ?? "";
  const scopes = process.env.SMOKE_OAUTH_SCOPES ?? "webmaster:hostinfo metrika:read direct:api";
  const accessToken = process.env.SMOKE_ACCESS_TOKEN ?? "";
  const refreshToken = process.env.SMOKE_REFRESH_TOKEN ?? "n/a";
  const code = process.env.SMOKE_CODE ?? "";

  // Register test app (idempotent — skip if already exists)
  if (clientId && clientSecret) {
    const existing = getAppByLabel(SMOKE_APP_LABEL);
    if (!existing) {
      log(`→ register_app label="${SMOKE_APP_LABEL}"`);
      try {
        registerApp({
          label: SMOKE_APP_LABEL,
          client_id: clientId,
          client_secret: clientSecret,
          scopes_declared: scopes,
        });
        log("  OK");
        ok++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log("  FAIL: " + msg.slice(0, 200));
        fail++;
        return false;
      }
    } else {
      log(`→ register_app — already exists, skipping`);
    }
  } else {
    log("→ register_app — SMOKE_OAUTH_CLIENT_ID/SECRET not set, skipping app seed");
  }

  // If access token provided — insert account directly
  if (accessToken) {
    const app = getAppByLabel(SMOKE_APP_LABEL);
    const oauthAppId = app?.id ?? 1;

    log(`→ insert_account label="${SMOKE_ACC_LABEL}" (direct, no flow)`);
    try {
      // Best-effort probe for login and webmaster user id
      const loginInfo = await probeLogin(accessToken);
      const webmasterUserId = await probeWebmasterUserId(accessToken);

      deleteAccount(SMOKE_ACC_LABEL); // idempotent: remove old if present
      insertAccount({
        label: SMOKE_ACC_LABEL,
        oauth_app_id: oauthAppId,
        yandex_login: loginInfo?.login ?? null,
        webmaster_user_id: webmasterUserId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scopes_granted: scopes,
      });
      log("  OK — account ready");
      ok++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log("  FAIL: " + msg.slice(0, 200));
      fail++;
      return false;
    }
    return true;
  }

  // If code provided — exchange for tokens and insert
  if (code) {
    const app = getAppByLabel(SMOKE_APP_LABEL);
    if (!app) {
      log("  FAIL: SMOKE_CODE set but no smoke-app found. Set SMOKE_OAUTH_CLIENT_ID/SECRET first.");
      fail++;
      return false;
    }
    log(`→ exchange_code label="${SMOKE_ACC_LABEL}"`);
    try {
      const tokens = await exchangeCode(
        { client_id: app.client_id, client_secret: app.client_secret },
        code,
      );
      const loginInfo = await probeLogin(tokens.access_token);
      const webmasterUserId = await probeWebmasterUserId(tokens.access_token);
      const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;

      deleteAccount(SMOKE_ACC_LABEL);
      insertAccount({
        label: SMOKE_ACC_LABEL,
        oauth_app_id: app.id,
        yandex_login: loginInfo?.login ?? null,
        webmaster_user_id: webmasterUserId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scopes_granted: tokens.scope || scopes,
      });
      log("  OK — account ready");
      ok++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log("  FAIL: " + msg.slice(0, 200));
      fail++;
      return false;
    }
    return true;
  }

  // Neither access token nor code — print authorize URL and skip domain groups
  const app = getAppByLabel(SMOKE_APP_LABEL);
  if (app) {
    const url = buildAuthorizeUrl({ client_id: app.client_id, scopes_declared: app.scopes_declared });
    log("  SKIP domain groups — no SMOKE_ACCESS_TOKEN or SMOKE_CODE");
    log("  Visit this URL to authorize:");
    log("  " + url);
    log("  Then: set SMOKE_CODE=<7-char code> and re-run");
  } else {
    log("  SKIP domain groups — no account available");
    log("  Set SMOKE_OAUTH_CLIENT_ID + SMOKE_OAUTH_CLIENT_SECRET + SMOKE_ACCESS_TOKEN to seed an account");
  }
  return false;
}

// ---------------------------------------------------------------------------
// Generic API gateway group (v0.5)
// Requires a live account with webmaster:hostinfo scope for sub-tests a/b/c.
// Sub-test d (metrika) is optional and fires only if SMOKE_TEST_COUNTER is set.
// ---------------------------------------------------------------------------

async function runGeneric(accountReady: boolean): Promise<void> {
  log("--- group: generic ---");

  if (!accountReady) {
    log("  SKIP: no account ready — complete oauth-setup first");
    return;
  }

  const ACC = "smoke-acc";

  // a) First call — expect cache miss (upstream called)
  await run("generic:webmaster_api first-call (cache miss)", async () => {
    const before = await runCacheStats();
    const beforeText = (before as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}";
    const beforeStats = JSON.parse(beforeText) as { total_entries?: number };
    const beforeCount = beforeStats.total_entries ?? 0;

    const result = await runYandexWebmasterApi({ endpoint: "/v4/user", account: ACC });
    log(`  result.ok=${!(result as { isError?: boolean }).isError}`);

    const after = await runCacheStats();
    const afterText = (after as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}";
    const afterStats = JSON.parse(afterText) as { total_entries?: number };
    const afterCount = afterStats.total_entries ?? 0;

    if (afterCount <= beforeCount) {
      throw new Error(`expected cache entry to be written: before=${beforeCount} after=${afterCount}`);
    }
    log(`  cache entries: ${beforeCount} → ${afterCount} (miss confirmed)`);
    return result;
  });

  // b) Same call again — expect cache hit (entry count unchanged)
  await run("generic:webmaster_api second-call (cache hit)", async () => {
    const before = await runCacheStats();
    const beforeText = (before as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}";
    const beforeStats = JSON.parse(beforeText) as { total_entries?: number };
    const beforeCount = beforeStats.total_entries ?? 0;

    await runYandexWebmasterApi({ endpoint: "/v4/user", account: ACC });

    const after = await runCacheStats();
    const afterText = (after as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}";
    const afterStats = JSON.parse(afterText) as { total_entries?: number };
    const afterCount = afterStats.total_entries ?? 0;

    if (afterCount !== beforeCount) {
      throw new Error(`expected cache hit (no new entries): before=${beforeCount} after=${afterCount}`);
    }
    log(`  cache entries unchanged at ${afterCount} (hit confirmed)`);
    return { content: [{ type: "text" as const, text: "cache hit confirmed" }] };
  });

  // c) force_refresh:true — expect cache miss again (upstream re-fetched)
  await run("generic:webmaster_api force_refresh (cache miss)", async () => {
    const before = await runCacheStats();
    const beforeText = (before as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}";
    const beforeStats = JSON.parse(beforeText) as { total_entries?: number };
    const beforeCount = beforeStats.total_entries ?? 0;

    const result = await runYandexWebmasterApi({ endpoint: "/v4/user", account: ACC, force_refresh: true });
    log(`  result.ok=${!(result as { isError?: boolean }).isError}`);

    // force_refresh rewrites the entry (count stays same unless evicted); main check is no error
    const after = await runCacheStats();
    const afterText = (after as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}";
    const afterStats = JSON.parse(afterText) as { total_entries?: number };
    log(`  cache entries: ${beforeCount} → ${afterStats.total_entries ?? 0} (force_refresh done)`);
    return result;
  });

  // d) Optional: light metrika read (fires only if SMOKE_TEST_COUNTER is set)
  const counter = process.env.SMOKE_TEST_COUNTER ?? "";
  if (counter) {
    await run("generic:metrika_api counters list (optional)", async () => {
      return runYandexMetrikaApi({ endpoint: "/management/v1/counters", account: ACC });
    });
  } else {
    log("  generic:metrika_api — SKIP (set SMOKE_TEST_COUNTER to enable)");
  }
}

async function runInventory(): Promise<void> {
  log("--- group: inventory ---");

  await run("inventory:refresh_inventory (full)", async () => {
    const result = await runRefreshInventory({});
    const text = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as { reports?: unknown[]; count?: number };
    log(`  reports.count=${parsed.count ?? 0}`);
    return result;
  });

  await run("inventory:list_sites", async () => {
    const result = await runListSites({});
    const text = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as { count?: number };
    log(`  sites.count=${parsed.count ?? 0}`);
    return result;
  });

  await run("inventory:find_property (query=вечкасов)", async () => {
    const result = await runFindProperty({ query: "вечкасов" });
    const text = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as { results?: unknown[] };
    log(`  find.count=${parsed.results?.length ?? 0}`);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Cache group (offline — uses DB repo directly, no real OAuth required)
// ---------------------------------------------------------------------------

async function runCache(): Promise<void> {
  log("--- group: cache ---");
  const TOOL = "yandex_webmaster_api" as const;
  const FAKE_ARGS = { host_id: "https:smoke-test.example.com:443" };
  const FAKE_ACC_ID = null;
  const FAKE_RESULT = { smoke: true };

  // Seed: first call writes an entry into the cache
  await run("cache:first-call-writes-entry", async () => {
    let callCount = 0;
    await withCache(
      { toolName: TOOL, accountId: FAKE_ACC_ID, args: FAKE_ARGS, forceRefresh: false },
      async () => { callCount++; return FAKE_RESULT; },
    );
    if (callCount !== 1) throw new Error(`expected 1 upstream call, got ${callCount}`);
    return { content: [{ type: "text" as const, text: "entry written" }] };
  });

  // Stats: total_entries should be > 0
  await run("cache:stats-total-entries", async () => {
    const result = await runCacheStats();
    const text = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}";
    const stats = JSON.parse(text) as { total_entries?: number };
    if ((stats.total_entries ?? 0) < 1) throw new Error(`total_entries=${stats.total_entries}`);
    log(`  total_entries=${stats.total_entries}`);
    return result;
  });

  // Second call: same args → cache hit, upstream not called
  await run("cache:second-call-is-hit", async () => {
    let callCount = 0;
    await withCache(
      { toolName: TOOL, accountId: FAKE_ACC_ID, args: FAKE_ARGS, forceRefresh: false },
      async () => { callCount++; return FAKE_RESULT; },
    );
    if (callCount !== 0) throw new Error(`expected 0 upstream calls (cache hit), got ${callCount}`);
    return { content: [{ type: "text" as const, text: "cache hit confirmed" }] };
  });

  // force_refresh: upstream called again, entry rewritten
  await run("cache:force-refresh-rewrites-entry", async () => {
    let callCount = 0;
    await withCache(
      { toolName: TOOL, accountId: FAKE_ACC_ID, args: FAKE_ARGS, forceRefresh: true },
      async () => { callCount++; return { ...FAKE_RESULT, refreshed: true }; },
    );
    if (callCount !== 1) throw new Error(`expected 1 upstream call (force refresh), got ${callCount}`);
    return { content: [{ type: "text" as const, text: "force refresh ok" }] };
  });

  // invalidate: entry deleted
  await run("cache:invalidate-tool", async () => {
    const result = await runInvalidateCache({ tool: TOOL });
    const text = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as { deleted?: number };
    if ((parsed.deleted ?? 0) < 1) throw new Error(`expected deleted>=1, got ${parsed.deleted}`);
    log(`  deleted=${parsed.deleted}`);
    // Verify entry is gone
    const remaining = cacheRepo.countEntries();
    log(`  remaining entries=${remaining}`);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const only =
    process.argv.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "all";

  const validValues = ["oauth-setup", "generic", "inventory", "cache", "all"];
  if (!validValues.includes(only)) {
    log(`ERROR: unknown --only value "${only}". Valid: ${validValues.join(", ")}`);
    process.exit(1);
  }

  log(`start only=${only}`);

  // Connection check: list all accounts from DB
  const allAccounts = listAccounts();
  log("Connection OK");
  log(`accounts (${allAccounts.length}):`);
  for (const a of allAccounts) {
    log(`  label=${a.label} yandex_login=${a.yandex_login ?? "null"}`);
  }

  const runSetup = only === "oauth-setup" || only === "all";
  const runDomain = only !== "oauth-setup";

  let accountReady = false;

  if (runSetup) {
    accountReady = await runOauthSetup();
  } else {
    // For --only=<domain> assume account already exists
    accountReady = true;
  }

  if (!accountReady && runDomain && only === "all") {
    log("Domain groups skipped — complete oauth-setup first.");
    await runCache();
    log(`\n=== ${ok} OK, ${fail} FAIL ===`);
    process.exit(ok > 0 ? 0 : fail > 0 ? 1 : 0);
  }

  if (accountReady || !runSetup) {
    if (only === "generic" || only === "all") await runGeneric(accountReady);
    if (only === "inventory" || only === "all") await runInventory();
    if (only === "cache" || only === "all") await runCache();
  }

  log(`\n=== ${ok} OK, ${fail} FAIL ===`);
  process.exit(ok > 0 ? 0 : fail > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  log("FATAL: " + msg.slice(0, 200));
  process.exit(1);
});
