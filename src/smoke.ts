/**
 * Smoke runner — exercises each tool group with real Yandex OAuth (v0.2 multi-account flow).
 * Output goes to stderr only (safe for MCP stdio).
 *
 * Usage:
 *   npm run smoke                       # all groups
 *   npm run smoke -- --only=oauth-setup
 *   npm run smoke -- --only=webmaster
 *   npm run smoke -- --only=metrika
 *   npm run smoke -- --only=wordstat
 *   npm run smoke -- --only=mutagen     # also requires SMOKE_MUTAGEN=1
 *
 * Env vars (smoke-only): MCP_YANDEX_SEO_MASTER_KEY (required), SMOKE_OAUTH_CLIENT_ID/SECRET,
 * SMOKE_OAUTH_SCOPES, SMOKE_ACCESS_TOKEN, SMOKE_REFRESH_TOKEN, SMOKE_CODE,
 * SMOKE_TEST_HOST, SMOKE_TEST_COUNTER, MUTAGEN_API_KEY, SMOKE_MUTAGEN.
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
import { insertAccount, deleteAccount } from "./lib/db/accounts-repo.js";
import { buildAuthorizeUrl, exchangeCode } from "./lib/oauth/yandex-flow.js";
import { probeLogin, probeWebmasterUserId } from "./lib/oauth/login-probe.js";

import { runWebmasterSiteSummary } from "./tools/webmaster-site-summary.js";
import { runWebmasterTopQueries } from "./tools/webmaster-top-queries.js";
import { runWebmasterIndexingIssues } from "./tools/webmaster-indexing-issues.js";
import { runMetrikaSearchPhrases } from "./tools/metrika-search-phrases.js";
import { runMetrikaTrafficSummary } from "./tools/metrika-traffic-summary.js";
import { runWordstatKeywords } from "./tools/wordstat-keywords.js";
import { runMutagenCompetition } from "./tools/mutagen-competition.js";
import { runRefreshInventory } from "./tools/refresh-inventory.js";
import { runListSites } from "./tools/list-sites.js";
import { runFindProperty } from "./tools/find-property.js";
import { runInvalidateCache } from "./tools/invalidate-cache.js";
import { runCacheStats } from "./tools/cache-stats.js";
import { withCache } from "./lib/cache/cache-policy.js";
import * as cacheRepo from "./lib/cache/query-cache-repo.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const log = (msg: string): void => {
  process.stderr.write("[smoke] " + msg + "\n");
};

function isoDateDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

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
// Domain groups
// ---------------------------------------------------------------------------

async function runWebmaster(): Promise<void> {
  log("--- group: webmaster ---");
  const host = process.env.SMOKE_TEST_HOST ?? "https:example.com:443";
  const date_from = isoDateDaysAgo(30);
  const date_to = isoToday();

  await run("webmaster:site-summary", () =>
    runWebmasterSiteSummary({ host_id: host, account: SMOKE_ACC_LABEL }),
  );
  await run("webmaster:top-queries", () =>
    runWebmasterTopQueries({ host_id: host, date_from, date_to, limit: 10, account: SMOKE_ACC_LABEL }),
  );
  await run("webmaster:indexing-issues", () =>
    runWebmasterIndexingIssues({ host_id: host, account: SMOKE_ACC_LABEL }),
  );
}

async function runMetrika(): Promise<void> {
  log("--- group: metrika ---");
  const counter_id = process.env.SMOKE_TEST_COUNTER ?? "12345";
  const date_from = isoDateDaysAgo(30);
  const date_to = isoToday();

  await run("metrika:search-phrases", () =>
    runMetrikaSearchPhrases({ counter_id, date_from, date_to, limit: 10, account: SMOKE_ACC_LABEL }),
  );
  await run("metrika:traffic-summary", () =>
    runMetrikaTrafficSummary({ counter_id, date_from, date_to, account: SMOKE_ACC_LABEL }),
  );
}

async function runWordstat(): Promise<void> {
  log("--- group: wordstat ---");
  await run("wordstat:keywords", () =>
    runWordstatKeywords({ phrases: ["seo тест"], poll_timeout_sec: 60, account: SMOKE_ACC_LABEL }),
  );
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

async function runMutagen(): Promise<void> {
  log("--- group: mutagen ---");
  if (process.env.SMOKE_MUTAGEN !== "1") {
    log("  SKIP: set SMOKE_MUTAGEN=1 to enable (costs balance)");
    return;
  }
  if (!process.env.MUTAGEN_API_KEY) {
    log("  SKIP: MUTAGEN_API_KEY not set");
    return;
  }
  await run("mutagen:competition", () =>
    runMutagenCompetition({ phrases: ["seo тест"] }),
  );
}

// ---------------------------------------------------------------------------
// Cache group (offline — uses DB repo directly, no real OAuth required)
// ---------------------------------------------------------------------------

async function runCache(): Promise<void> {
  log("--- group: cache ---");
  const TOOL = "webmaster_site_summary" as const;
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

  const validValues = ["oauth-setup", "webmaster", "metrika", "wordstat", "mutagen", "inventory", "cache", "all"];
  if (!validValues.includes(only)) {
    log(`ERROR: unknown --only value "${only}". Valid: ${validValues.join(", ")}`);
    process.exit(1);
  }

  log(`start only=${only}`);

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
    if (only === "webmaster" || only === "all") await runWebmaster();
    if (only === "metrika" || only === "all") await runMetrika();
    if (only === "wordstat" || only === "all") await runWordstat();
    if (only === "mutagen" || only === "all") await runMutagen();
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
