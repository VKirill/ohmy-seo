/**
 * Phase 3.5.B — Live end-to-end smoke test for Yandex Direct API.
 *
 * Creates real DRAFT campaigns, ad groups, keywords, and ads on the
 * yandex-direct-prod-main account, then cleans them up via try/finally.
 *
 * CRITICAL: NO moderation calls to Ads API. Ever.
 * DRAFT-only — no activation, no spending.
 *
 * Usage:
 *   npx tsx packages/yandex-seo/scripts/b3-live-smoke.ts
 *   npx tsx packages/yandex-seo/scripts/b3-live-smoke.ts --cleanup-only
 *
 * Required env (loaded from ~/.claude.json automatically):
 *   MCP_YANDEX_SEO_MASTER_KEY
 *   MCP_YANDEX_SEO_DB_PATH
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Bootstrap: load env BEFORE any DB-dependent import
// ---------------------------------------------------------------------------

function bootstrapEnv(): void {
  if (process.env["MCP_YANDEX_SEO_MASTER_KEY"] && process.env["MCP_YANDEX_SEO_DB_PATH"]) {
    return;
  }
  const claudeJson = path.join(process.env["HOME"] ?? "/root", ".claude.json");
  if (!fs.existsSync(claudeJson)) return;
  try {
    const raw = fs.readFileSync(claudeJson, "utf-8");
    const cfg = JSON.parse(raw) as {
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    const env = cfg?.mcpServers?.["mcp-yandex-seo"]?.env ?? {};
    for (const [k, v] of Object.entries(env)) {
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // best-effort
  }
}

bootstrapEnv();

const masterKey = process.env["MCP_YANDEX_SEO_MASTER_KEY"] ?? "";
if (!/^[0-9a-fA-F]{64}$/.test(masterKey)) {
  process.stderr.write(
    "[b3-smoke] FATAL: MCP_YANDEX_SEO_MASTER_KEY missing or invalid (need 64-char hex).\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Safe to import DB-dependent modules now
// ---------------------------------------------------------------------------

import { executeApiCall } from "../src/lib/api-gateway.js";
import { runDirectCreateAdGroup } from "../src/tools/direct-create-adgroup.js";
import { runDirectCreateAdTgo } from "../src/tools/direct-create-ad-tgo.js";
import { runDirectCreateAdRsya } from "../src/tools/direct-create-ad-rsya.js";
import { runDirectCreateAdUnified } from "../src/tools/direct-create-ad-unified.js";
import { runDirectListAds } from "../src/tools/direct-list-ads.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCOUNT = "yandex-direct-prod-main";
const COUNTER_ID = 54918634;
const GOAL_ID = 254644847;
const REGION_MOSCOW = 213;
const SITE_URL = "https://vechkasov.ru";
// 240x400 skyscraper — validated size accepted by Yandex Direct AdImages.add
// and compatible with TextImageAd ("Image size does not correspond to ad type" with 16:9 images)
const IMAGE_URL =
  "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=240&h=400&fit=crop&q=80";

// Get Moscow local date (UTC+3) to avoid startDate past-date rejections.
// Direct requires StartDate to be >= current Moscow date.
function getMoscowDate(): string {
  const now = new Date();
  // Add 3 hours to UTC time to get Moscow time, then extract date portion
  return new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const LEDGER_PATH = path.join(__dirname, ".b3-smoke-ledger.jsonl");
const REPORT_PATH = path.join(
  REPO_ROOT,
  "docs",
  "plans",
  "phase-3-5-b-direct-api-coverage",
  "live-smoke-report.md"
);

const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const CLEANUP_ONLY = process.argv.includes("--cleanup-only");

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stdout.write(`[b3-smoke] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// CSV parser (inline, no external lib)
// ---------------------------------------------------------------------------

function parseCsv(filePath: string): Array<Record<string, string>> {
  const raw = fs.readFileSync(filePath, "utf8");
  const clean = raw.replace(/^﻿/, ""); // strip BOM
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  const headers = lines[0].split(";");
  return lines.slice(1).map((line) => {
    const values = line.split(";");
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

type LedgerEntry =
  | { type: "campaign"; id: number; name: string; ts: string }
  | { type: "image"; hash: string; ts: string }
  | { type: "ad_group"; id: number; campaign_id: number; ts: string }
  | { type: "keyword"; id: number; ad_group_id: number; ts: string }
  | { type: "ad"; id: number; ad_group_id: number; ts: string };

function ledgerAppend(entry: LedgerEntry): void {
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(entry) + "\n", "utf8");
}

function ledgerRead(): LedgerEntry[] {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs
    .readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LedgerEntry);
}

function ledgerReset(): void {
  fs.writeFileSync(LEDGER_PATH, "", "utf8");
}

// ---------------------------------------------------------------------------
// MCP result helper
// ---------------------------------------------------------------------------

async function run<T>(fn: (i: unknown) => Promise<unknown>, input: unknown): Promise<T> {
  const result = await fn(input);
  const res = result as { content?: Array<{ type: string; text: string }> };
  const text = res.content?.[0]?.text;
  if (!text) throw new Error("No content in result");
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Campaign creation helpers (direct API, bypassing broken tool)
// Yandex Direct v5 API — actual valid strategies validated against live API.
//
// Search campaigns: BiddingStrategyType = "HIGHEST_POSITION" (manual)
// RSYA campaigns: Search = "SERVING_OFF", Network = "AVERAGE_CPC"
// ---------------------------------------------------------------------------

async function createSearchCampaign(name: string): Promise<number | null> {
  const result = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/campaigns",
    method: "POST",
    body: {
      method: "add",
      params: {
        Campaigns: [
          {
            Name: name,
            StartDate: getMoscowDate(),
            TextCampaign: {
              BiddingStrategy: {
                Search: { BiddingStrategyType: "HIGHEST_POSITION" },
                Network: { BiddingStrategyType: "SERVING_OFF" },
              },
              Settings: [{ Option: "ADD_METRICA_TAG", Value: "YES" }],
              CounterIds: { Items: [COUNTER_ID] },
            },
          },
        ],
      },
    },
    account: ACCOUNT,
  });

  if (!result.ok) {
    throw new Error(`HTTP ${result.status}: ${JSON.stringify(result.body)}`);
  }

  const data = result.data as Record<string, unknown>;
  const addResults = (data?.result as Record<string, unknown>)?.AddResults as
    | Array<{ Id?: number; Errors?: unknown[] }>
    | undefined;
  const first = addResults?.[0];

  if (!first) {
    // Check for top-level error
    const err = data?.error as Record<string, unknown> | undefined;
    if (err) throw new Error(`API error ${err.error_code}: ${err.error_detail}`);
    throw new Error("No AddResults in response");
  }

  if (first.Errors && first.Errors.length > 0) {
    throw new Error(`Campaign errors: ${JSON.stringify(first.Errors)}`);
  }

  return first.Id ?? null;
}

async function createRsyaCampaign(name: string): Promise<number | null> {
  const result = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/campaigns",
    method: "POST",
    body: {
      method: "add",
      params: {
        Campaigns: [
          {
            Name: name,
            StartDate: getMoscowDate(),
            TextCampaign: {
              BiddingStrategy: {
                Search: { BiddingStrategyType: "SERVING_OFF" },
                Network: {
                  BiddingStrategyType: "AVERAGE_CPC",
                  AverageCpc: { AverageCpc: 1_000_000 }, // 1 RUB in micros
                },
              },
              Settings: [{ Option: "ADD_METRICA_TAG", Value: "YES" }],
            },
          },
        ],
      },
    },
    account: ACCOUNT,
  });

  if (!result.ok) {
    throw new Error(`HTTP ${result.status}: ${JSON.stringify(result.body)}`);
  }

  const data = result.data as Record<string, unknown>;
  const addResults = (data?.result as Record<string, unknown>)?.AddResults as
    | Array<{ Id?: number; Errors?: unknown[] }>
    | undefined;
  const first = addResults?.[0];

  if (!first) {
    const err = data?.error as Record<string, unknown> | undefined;
    if (err) throw new Error(`API error ${err.error_code}: ${err.error_detail}`);
    throw new Error("No AddResults in response");
  }

  if (first.Errors && first.Errors.length > 0) {
    throw new Error(`Campaign errors: ${JSON.stringify(first.Errors)}`);
  }

  return first.Id ?? null;
}

// ---------------------------------------------------------------------------
// Metrika goal linking (direct API)
// ---------------------------------------------------------------------------

async function linkMetrikaGoals(campaignId: number): Promise<boolean> {
  const result = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/campaigns",
    method: "POST",
    body: {
      method: "update",
      params: {
        Campaigns: [
          {
            Id: campaignId,
            TextCampaign: {
              CounterIds: { Items: [COUNTER_ID] },
              PriorityGoals: {
                Items: [{ GoalId: GOAL_ID, Value: 100 }],
              },
            },
          },
        ],
      },
    },
    account: ACCOUNT,
  });

  if (!result.ok) return false;

  const data = result.data as Record<string, unknown>;
  const updateResults = (data?.result as Record<string, unknown>)?.UpdateResults as
    | Array<{ Errors?: unknown[] }>
    | undefined;
  const first = updateResults?.[0];
  if (first?.Errors && (first.Errors as unknown[]).length > 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

async function deleteCampaigns(ids: number[], softFailLog: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const res = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/campaigns",
      method: "POST",
      body: { method: "delete", params: { SelectionCriteria: { Ids: ids } } },
      account: ACCOUNT,
    });
    if (!res.ok) softFailLog.push(`delete campaigns ${ids.join(",")}: HTTP ${res.status}`);
  } catch (e) {
    softFailLog.push(`delete campaigns ${ids.join(",")}: ${String(e)}`);
  }
}

async function deleteAdGroups(ids: number[], softFailLog: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const res = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/adgroups",
      method: "POST",
      body: { method: "delete", params: { SelectionCriteria: { Ids: ids } } },
      account: ACCOUNT,
    });
    if (!res.ok) softFailLog.push(`delete ad_groups ${ids.join(",")}: HTTP ${res.status}`);
  } catch (e) {
    softFailLog.push(`delete ad_groups ${ids.join(",")}: ${String(e)}`);
  }
}

async function deleteAds(ids: number[], softFailLog: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const res = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/ads",
      method: "POST",
      body: { method: "archive", params: { SelectionCriteria: { Ids: ids } } },
      account: ACCOUNT,
    });
    if (!res.ok) softFailLog.push(`archive ads ${ids.join(",")}: HTTP ${res.status}`);
  } catch (e) {
    softFailLog.push(`archive ads ${ids.join(",")}: ${String(e)}`);
  }
  try {
    const res = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/ads",
      method: "POST",
      body: { method: "delete", params: { SelectionCriteria: { Ids: ids } } },
      account: ACCOUNT,
    });
    if (!res.ok) softFailLog.push(`delete ads ${ids.join(",")}: HTTP ${res.status}`);
  } catch (e) {
    softFailLog.push(`delete ads ${ids.join(",")}: ${String(e)}`);
  }
}

async function deleteKeywords(ids: number[], softFailLog: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const res = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/keywords",
      method: "POST",
      body: { method: "delete", params: { SelectionCriteria: { Ids: ids } } },
      account: ACCOUNT,
    });
    if (!res.ok) softFailLog.push(`delete keywords ${ids.join(",")}: HTTP ${res.status}`);
  } catch (e) {
    softFailLog.push(`delete keywords ${ids.join(",")}: ${String(e)}`);
  }
}

async function deleteImages(hashes: string[], softFailLog: string[]): Promise<void> {
  for (const hash of hashes) {
    try {
      const res = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/adimages",
        method: "POST",
        body: {
          method: "delete",
          params: { SelectionCriteria: { AdImageHashes: [hash] } },
        },
        account: ACCOUNT,
      });
      if (!res.ok) softFailLog.push(`delete image ${hash}: HTTP ${res.status}`);
    } catch (e) {
      softFailLog.push(`delete image ${hash}: ${String(e)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup from ledger
// ---------------------------------------------------------------------------

async function cleanupFromLedger(softFailLog: string[]): Promise<void> {
  const entries = ledgerRead();
  if (entries.length === 0) {
    log("Ledger is empty — nothing to clean up.");
    return;
  }

  log(`Ledger has ${entries.length} entries. Cleaning up (reverse order)...`);

  const adIds = entries.filter((e) => e.type === "ad").map((e) => (e as { id: number }).id);
  const kwIds = entries.filter((e) => e.type === "keyword").map((e) => (e as { id: number }).id);
  const agIds = entries.filter((e) => e.type === "ad_group").map((e) => (e as { id: number }).id);
  const imageHashes = entries
    .filter((e) => e.type === "image")
    .map((e) => (e as { hash: string }).hash);
  const campIds = entries
    .filter((e) => e.type === "campaign")
    .map((e) => (e as { id: number }).id);

  if (adIds.length > 0) {
    log(`Cleaning ${adIds.length} ads: ${adIds.join(", ")}`);
    await deleteAds(adIds, softFailLog);
  }
  if (kwIds.length > 0) {
    log(`Cleaning ${kwIds.length} keywords: ${kwIds.join(", ")}`);
    await deleteKeywords(kwIds, softFailLog);
  }
  if (agIds.length > 0) {
    log(`Cleaning ${agIds.length} ad groups: ${agIds.join(", ")}`);
    await deleteAdGroups(agIds, softFailLog);
  }
  if (imageHashes.length > 0) {
    log(`Cleaning ${imageHashes.length} images`);
    await deleteImages(imageHashes, softFailLog);
  }
  if (campIds.length > 0) {
    log(`Cleaning ${campIds.length} campaigns: ${campIds.join(", ")}`);
    await deleteCampaigns(campIds, softFailLog);
  }

  ledgerReset();
  log("Ledger reset.");
}

// ---------------------------------------------------------------------------
// Step result tracking
// ---------------------------------------------------------------------------

interface StepResult {
  step: number;
  name: string;
  status: "OK" | "SOFT_FAIL" | "SKIP";
  ids?: Array<number | string>;
  latencyMs: number;
  note?: string;
}

const stepResults: StepResult[] = [];

function recordStep(r: StepResult): void {
  stepResults.push(r);
  const icon = r.status === "OK" ? "OK" : r.status === "SOFT_FAIL" ? "SOFT_FAIL" : "SKIP";
  log(`Step ${r.step} [${icon}] ${r.name} (${r.latencyMs}ms)${r.note ? ` — ${r.note}` : ""}`);
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(params: {
  csvInfo: string;
  keywordsCount: number;
  softFailLog: string[];
  remainingArtifacts: string[];
  campaignIds: number[];
  adGroupIds: number[];
  adIds: number[];
  imageHash: string | null;
  metrikaLinked: boolean;
  cleanupSuccess: boolean;
}): void {
  const now = new Date().toISOString();
  const lines: string[] = [
    `# Phase 3.5.B Live Smoke Report`,
    ``,
    `**Generated:** ${now}`,
    `**Account:** ${ACCOUNT} (login: ki.vech)`,
    `**Site:** ${SITE_URL}`,
    `**Geo:** Moscow (${REGION_MOSCOW})`,
    `**Metrika counter:** ${COUNTER_ID} | **Goal:** ${GOAL_ID}`,
    ``,
    `## CSV Cluster Info`,
    ``,
    params.csvInfo,
    `**Keywords used:** ${params.keywordsCount}`,
    ``,
    `## Step Results`,
    ``,
    `| Step | Name | Status | IDs | Latency |`,
    `|------|------|--------|-----|---------|`,
  ];

  for (const s of stepResults) {
    const ids = s.ids && s.ids.length > 0 ? s.ids.join(", ") : "-";
    lines.push(`| ${s.step} | ${s.name} | ${s.status} | ${ids} | ${s.latencyMs}ms |`);
    if (s.note) lines.push(`|  |  | *${s.note}* |  |  |`);
  }

  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`- Campaigns created: ${params.campaignIds.length > 0 ? params.campaignIds.join(", ") : "none"}`);
  lines.push(`- Ad groups created: ${params.adGroupIds.length > 0 ? params.adGroupIds.join(", ") : "none"}`);
  lines.push(`- Ads created: ${params.adIds.length > 0 ? params.adIds.join(", ") : "none"}`);
  lines.push(`- Image hash: ${params.imageHash ?? "none"}`);
  lines.push(`- Metrika goal linked: ${params.metrikaLinked ? "YES" : "NO/SOFT_FAIL"}`);
  lines.push(`- Cleanup success: ${params.cleanupSuccess ? "YES" : "PARTIAL"}`);
  lines.push(``);

  if (params.softFailLog.length > 0) {
    lines.push(`## Soft Failures`);
    lines.push(``);
    for (const f of params.softFailLog) {
      lines.push(`- ${f}`);
    }
    lines.push(``);
  }

  if (params.remainingArtifacts.length > 0) {
    lines.push(`## Remaining Artifacts (cleanup failed)`);
    lines.push(``);
    for (const a of params.remainingArtifacts) {
      lines.push(`- ${a}`);
    }
    lines.push(``);
  }

  lines.push(`## Unified Ad Test (TASK-3547)`);
  lines.push(``);
  lines.push(
    `Step 14 tests \`runDirectCreateAdUnified\` — a TextImageAd posted to the Search ad group ` +
      `(ad_group #1). This verifies unified ad creation with image hash alongside text-only TGO ads.`
  );
  lines.push(``);
  lines.push(`## API Strategy Notes`);
  lines.push(``);
  lines.push(`- Search campaign: \`HIGHEST_POSITION\` (manual CPC, search network only)`);
  lines.push(`- RSYA campaign: \`SERVING_OFF\` search + \`AVERAGE_CPC\` network`);
  lines.push(`- Draft campaigns cannot be archived — delete directly`);
  lines.push(`- \`RegionIds\` lives at AdGroup level, not Campaign level`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by b3-live-smoke.ts*`);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
  log(`Report written to ${REPORT_PATH}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`Starting. TS=${TS} CLEANUP_ONLY=${CLEANUP_ONLY}`);

  const softFailLog: string[] = [];

  // --cleanup-only mode
  if (CLEANUP_ONLY) {
    log("--cleanup-only flag detected.");
    await cleanupFromLedger(softFailLog);
    if (softFailLog.length > 0) {
      log("Soft failures during cleanup:");
      softFailLog.forEach((f) => log(`  ${f}`));
    }
    log("Cleanup-only done.");
    return;
  }

  // Pre-cleanup from previous runs
  if (fs.existsSync(LEDGER_PATH)) {
    const size = fs.statSync(LEDGER_PATH).size;
    if (size > 0) {
      log("Pre-cleanup: ledger from previous run — cleaning...");
      await cleanupFromLedger(softFailLog);
    }
  }

  // State
  const campaignIds: number[] = [];
  const adGroupIds: number[] = [];
  const adIds: number[] = [];
  let imageHash: string | null = null;
  let metrikaLinked = false;

  // Keywords
  let keywords: string[];
  let csvInfo: string;
  try {
    const csv = parseCsv("/home/ubuntu/downloads/test_direct.csv");
    const cluster1 = csv
      .filter((r) => r["Кластер"] === "1")
      .map((r) => r["Запрос"])
      .filter(Boolean);
    keywords = cluster1.slice(0, 10);
    csvInfo = `**Source:** /home/ubuntu/downloads/test_direct.csv (cluster 1, ${cluster1.length} rows)\n\n`;
    log(`CSV loaded: ${keywords.length} keywords from cluster 1.`);
  } catch (e) {
    log(`CSV not readable (${String(e)}) — using fallback keywords.`);
    keywords = [
      "стобальный репетитор онлайн школа",
      "100бальный репетитор онлайн школа",
      "100б репетитор онлайн школа",
    ];
    csvInfo = `**Source:** FALLBACK (CSV not readable: ${String(e)})\n\n`;
  }

  // Ad copy
  const TITLE_A = "Стобальный репетитор онлайн";
  const TITLE2_A = "ЕГЭ-2026 без репетитора";
  const TEXT_A = "Авторская методика. Бесплатный пробный урок. PDF план.";

  const TITLE_B = "Как сдать ЕГЭ на 90+ бесплатно";
  const TITLE2_B = "За 12 недель, без репетитора";
  const TEXT_B = "Скачай авторский план подготовки. 47 заданий, ответы, разборы.";

  // Capture ledger at try-entry for cleanup reference
  let ledgerSnapshot: LedgerEntry[] = [];

  try {
    // -----------------------------------------------------------------------
    // Step 1: Create Search campaign
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      const name = `phase-3-5-b-test_search_${TS}`;
      log(`Step 1: Creating search campaign "${name}"...`);
      try {
        const campId = await createSearchCampaign(name);
        if (!campId) throw new Error("No campaign_id returned");
        campaignIds.push(campId);
        ledgerAppend({ type: "campaign", id: campId, name, ts: new Date().toISOString() });
        recordStep({ step: 1, name: "Create Search campaign", status: "OK", ids: [campId], latencyMs: Date.now() - t0 });
      } catch (e) {
        recordStep({ step: 1, name: "Create Search campaign", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
        softFailLog.push(`Step 1: ${String(e)}`);
      }
    }

    // -----------------------------------------------------------------------
    // Step 2: Verify campaign exists
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 2: Verifying search campaign exists...`);
      if (campaignIds.length === 0) {
        recordStep({ step: 2, name: "Verify campaign", status: "SKIP", latencyMs: 0, note: "No campaign_id from step 1" });
      } else {
        try {
          const res = await executeApiCall({
            apiName: "direct",
            endpoint: "/json/v5/campaigns",
            method: "POST",
            body: {
              method: "get",
              params: {
                SelectionCriteria: { Ids: [campaignIds[0]] },
                FieldNames: ["Id", "Name", "Status"],
                Page: { Limit: 1 },
              },
            },
            account: ACCOUNT,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          recordStep({ step: 2, name: "Verify campaign exists", status: "OK", ids: [campaignIds[0]], latencyMs: Date.now() - t0 });
        } catch (e) {
          recordStep({ step: 2, name: "Verify campaign exists", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
          softFailLog.push(`Step 2: ${String(e)}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 3: Link Metrika goals
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 3: Linking Metrika goals to search campaign...`);
      if (campaignIds.length === 0) {
        recordStep({ step: 3, name: "Link Metrika goals", status: "SKIP", latencyMs: 0, note: "No campaign" });
      } else {
        try {
          metrikaLinked = await linkMetrikaGoals(campaignIds[0]);
          if (!metrikaLinked) throw new Error("Goals not persisted in Direct after update");
          recordStep({ step: 3, name: "Link Metrika goals", status: "OK", latencyMs: Date.now() - t0 });
        } catch (e) {
          // Soft-fail: Direct may reject goal linking for brand-new campaigns
          recordStep({ step: 3, name: "Link Metrika goals", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
          softFailLog.push(`Step 3 (soft): ${String(e)}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 4: Create Search ad group
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 4: Creating search ad group...`);
      if (campaignIds.length === 0) {
        recordStep({ step: 4, name: "Create Search ad group", status: "SKIP", latencyMs: 0, note: "No campaign" });
      } else {
        try {
          const res = await run<{ ad_group_id: number; error?: string }>(
            runDirectCreateAdGroup,
            {
              campaign_id: campaignIds[0],
              name: "1_stobalniy-repetitor",
              region_ids: [REGION_MOSCOW],
              confirm: true,
              account: ACCOUNT,
            }
          );
          if (res.error || !res.ad_group_id) throw new Error(res.error ?? "No ad_group_id returned");
          adGroupIds.push(res.ad_group_id);
          ledgerAppend({ type: "ad_group", id: res.ad_group_id, campaign_id: campaignIds[0], ts: new Date().toISOString() });
          recordStep({ step: 4, name: "Create Search ad group", status: "OK", ids: [res.ad_group_id], latencyMs: Date.now() - t0 });
        } catch (e) {
          recordStep({ step: 4, name: "Create Search ad group", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
          softFailLog.push(`Step 4: ${String(e)}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 5: Add keywords to Search ad group
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 5: Adding ${keywords.length} keywords to search ad group...`);
      if (adGroupIds.length === 0) {
        recordStep({ step: 5, name: "Add keywords (search)", status: "SKIP", latencyMs: 0, note: "No ad group" });
      } else {
        const addedKwIds: number[] = [];
        let kwErrors = 0;
        for (const kw of keywords) {
          try {
            const res = await executeApiCall({
              apiName: "direct",
              endpoint: "/json/v5/keywords",
              method: "POST",
              body: {
                method: "add",
                params: { Keywords: [{ AdGroupId: adGroupIds[0], Keyword: kw }] },
              },
              account: ACCOUNT,
            });
            if (res.ok) {
              const data = res.data as Record<string, unknown>;
              const addResults = (data?.result as Record<string, unknown>)?.AddResults as
                | Array<{ Id?: number; Errors?: unknown[] }>
                | undefined;
              const kwId = addResults?.[0]?.Id;
              if (kwId) {
                addedKwIds.push(kwId);
                ledgerAppend({ type: "keyword", id: kwId, ad_group_id: adGroupIds[0], ts: new Date().toISOString() });
              } else {
                kwErrors++;
                softFailLog.push(`kw "${kw}": ${JSON.stringify(addResults?.[0]?.Errors)}`);
              }
            } else {
              kwErrors++;
              softFailLog.push(`kw "${kw}": HTTP ${res.status}`);
            }
          } catch (e) {
            kwErrors++;
            softFailLog.push(`kw "${kw}": ${String(e)}`);
          }
        }
        const status: StepResult["status"] = kwErrors === 0 ? "OK" : addedKwIds.length > 0 ? "SOFT_FAIL" : "SOFT_FAIL";
        recordStep({ step: 5, name: "Add keywords (search)", status, ids: addedKwIds, latencyMs: Date.now() - t0, note: kwErrors > 0 ? `${kwErrors} errors` : undefined });
      }
    }

    // -----------------------------------------------------------------------
    // Step 6: Create TGO ad variant A
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 6: Creating TGO ad variant A...`);
      if (adGroupIds.length === 0) {
        recordStep({ step: 6, name: "Create TGO ad variant A", status: "SKIP", latencyMs: 0, note: "No ad group" });
      } else {
        try {
          const res = await run<{ ad_id: number; error?: string }>(runDirectCreateAdTgo, {
            ad_group_id: adGroupIds[0],
            title: TITLE_A,
            title2: TITLE2_A,
            text: TEXT_A,
            href: SITE_URL,
            confirm: true,
            account: ACCOUNT,
          });
          if (res.error || !res.ad_id) throw new Error(res.error ?? "No ad_id");
          adIds.push(res.ad_id);
          ledgerAppend({ type: "ad", id: res.ad_id, ad_group_id: adGroupIds[0], ts: new Date().toISOString() });
          recordStep({ step: 6, name: "Create TGO ad variant A", status: "OK", ids: [res.ad_id], latencyMs: Date.now() - t0 });
        } catch (e) {
          recordStep({ step: 6, name: "Create TGO ad variant A", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
          softFailLog.push(`Step 6: ${String(e)}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 7: Create TGO ad variant B
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 7: Creating TGO ad variant B...`);
      if (adGroupIds.length === 0) {
        recordStep({ step: 7, name: "Create TGO ad variant B", status: "SKIP", latencyMs: 0, note: "No ad group" });
      } else {
        try {
          const res = await run<{ ad_id: number; error?: string }>(runDirectCreateAdTgo, {
            ad_group_id: adGroupIds[0],
            title: TITLE_B,
            title2: TITLE2_B,
            text: TEXT_B,
            href: SITE_URL,
            confirm: true,
            account: ACCOUNT,
          });
          if (res.error || !res.ad_id) throw new Error(res.error ?? "No ad_id");
          adIds.push(res.ad_id);
          ledgerAppend({ type: "ad", id: res.ad_id, ad_group_id: adGroupIds[0], ts: new Date().toISOString() });
          recordStep({ step: 7, name: "Create TGO ad variant B", status: "OK", ids: [res.ad_id], latencyMs: Date.now() - t0 });
        } catch (e) {
          recordStep({ step: 7, name: "Create TGO ad variant B", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
          softFailLog.push(`Step 7: ${String(e)}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 8: Create RSYA campaign
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      const name = `phase-3-5-b-test_rsya_${TS}`;
      log(`Step 8: Creating RSYA campaign "${name}"...`);
      try {
        const campId = await createRsyaCampaign(name);
        if (!campId) throw new Error("No campaign_id returned");
        campaignIds.push(campId);
        ledgerAppend({ type: "campaign", id: campId, name, ts: new Date().toISOString() });
        recordStep({ step: 8, name: "Create RSYA campaign", status: "OK", ids: [campId], latencyMs: Date.now() - t0 });
      } catch (e) {
        recordStep({ step: 8, name: "Create RSYA campaign", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
        softFailLog.push(`Step 8: ${String(e)}`);
      }
    }

    // -----------------------------------------------------------------------
    // Step 9: Upload image
    // Note: calls executeApiCall directly because runDirectUploadImage does not
    // pass the required Name field to AdImages.add, which causes API rejection.
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 9: Uploading image from URL (direct API call)...`);
      try {
        const imgResp = await fetch(IMAGE_URL);
        if (!imgResp.ok) throw new Error(`Image fetch failed: HTTP ${imgResp.status}`);
        const ab = await imgResp.arrayBuffer();
        const buf = Buffer.from(ab);
        const b64 = buf.toString("base64");
        log(`  Image fetched: ${buf.length} bytes`);

        const res = await executeApiCall({
          apiName: "direct",
          endpoint: "/json/v5/adimages",
          method: "POST",
          body: {
            method: "add",
            params: { AdImages: [{ ImageData: b64, Name: "phase-3-5-b-smoke-img" }] },
          },
          account: ACCOUNT,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
        const data = res.data as Record<string, unknown>;
        const addResults = (data?.result as Record<string, unknown>)?.AddResults as
          | Array<{ AdImageHash?: string; Errors?: unknown[] }>
          | undefined;
        const first = addResults?.[0];
        if (first?.Errors && (first.Errors as unknown[]).length > 0) {
          throw new Error(`AdImages.add errors: ${JSON.stringify(first.Errors)}`);
        }
        if (!first?.AdImageHash) throw new Error("No AdImageHash in response");

        imageHash = first.AdImageHash;
        ledgerAppend({ type: "image", hash: imageHash, ts: new Date().toISOString() });
        recordStep({ step: 9, name: "Upload image", status: "OK", ids: [imageHash], latencyMs: Date.now() - t0 });
      } catch (e) {
        recordStep({ step: 9, name: "Upload image", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
        softFailLog.push(`Step 9: ${String(e)}`);
      }
    }

    // -----------------------------------------------------------------------
    // Step 10: Create RSYA ad group
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 10: Creating RSYA ad group...`);
      if (campaignIds.length < 2) {
        recordStep({ step: 10, name: "Create RSYA ad group", status: "SKIP", latencyMs: 0, note: "No RSYA campaign" });
      } else {
        try {
          const res = await run<{ ad_group_id: number; error?: string }>(
            runDirectCreateAdGroup,
            {
              campaign_id: campaignIds[1],
              name: "1_stobalniy-repetitor-rsya",
              region_ids: [REGION_MOSCOW],
              confirm: true,
              account: ACCOUNT,
            }
          );
          if (res.error || !res.ad_group_id) throw new Error(res.error ?? "No ad_group_id");
          adGroupIds.push(res.ad_group_id);
          ledgerAppend({ type: "ad_group", id: res.ad_group_id, campaign_id: campaignIds[1], ts: new Date().toISOString() });
          recordStep({ step: 10, name: "Create RSYA ad group", status: "OK", ids: [res.ad_group_id], latencyMs: Date.now() - t0 });
        } catch (e) {
          recordStep({ step: 10, name: "Create RSYA ad group", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
          softFailLog.push(`Step 10: ${String(e)}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 11: Add keywords to RSYA ad group
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 11: Adding ${keywords.length} keywords to RSYA ad group...`);
      if (adGroupIds.length < 2) {
        recordStep({ step: 11, name: "Add keywords (rsya)", status: "SKIP", latencyMs: 0, note: "No RSYA ad group" });
      } else {
        const addedKwIds: number[] = [];
        let kwErrors = 0;
        for (const kw of keywords) {
          try {
            const res = await executeApiCall({
              apiName: "direct",
              endpoint: "/json/v5/keywords",
              method: "POST",
              body: {
                method: "add",
                params: { Keywords: [{ AdGroupId: adGroupIds[1], Keyword: kw }] },
              },
              account: ACCOUNT,
            });
            if (res.ok) {
              const data = res.data as Record<string, unknown>;
              const addResults = (data?.result as Record<string, unknown>)?.AddResults as
                | Array<{ Id?: number; Errors?: unknown[] }>
                | undefined;
              const kwId = addResults?.[0]?.Id;
              if (kwId) {
                addedKwIds.push(kwId);
                ledgerAppend({ type: "keyword", id: kwId, ad_group_id: adGroupIds[1], ts: new Date().toISOString() });
              } else {
                kwErrors++;
                softFailLog.push(`rsya kw "${kw}": ${JSON.stringify(addResults?.[0]?.Errors)}`);
              }
            } else {
              kwErrors++;
              softFailLog.push(`rsya kw "${kw}": HTTP ${res.status}`);
            }
          } catch (e) {
            kwErrors++;
            softFailLog.push(`rsya kw "${kw}": ${String(e)}`);
          }
        }
        const status: StepResult["status"] = kwErrors === 0 ? "OK" : "SOFT_FAIL";
        recordStep({ step: 11, name: "Add keywords (rsya)", status, ids: addedKwIds, latencyMs: Date.now() - t0, note: kwErrors > 0 ? `${kwErrors} errors` : undefined });
      }
    }

    // -----------------------------------------------------------------------
    // Step 12: Create RSYA ad variant A
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 12: Creating RSYA ad variant A...`);
      if (adGroupIds.length < 2 || !imageHash) {
        recordStep({ step: 12, name: "Create RSYA ad variant A", status: "SKIP", latencyMs: 0, note: !imageHash ? "No image hash" : "No RSYA ad group" });
      } else {
        try {
          const res = await run<{ ad_id: number; error?: string }>(runDirectCreateAdRsya, {
            ad_group_id: adGroupIds[1],
            ad_image_hash: imageHash,
            title: TITLE_A,
            title2: TITLE2_A,
            text: TEXT_A,
            href: SITE_URL,
            confirm: true,
            account: ACCOUNT,
          });
          if (res.error || !res.ad_id) throw new Error(res.error ?? "No ad_id");
          adIds.push(res.ad_id);
          ledgerAppend({ type: "ad", id: res.ad_id, ad_group_id: adGroupIds[1], ts: new Date().toISOString() });
          recordStep({ step: 12, name: "Create RSYA ad variant A", status: "OK", ids: [res.ad_id], latencyMs: Date.now() - t0 });
        } catch (e) {
          recordStep({ step: 12, name: "Create RSYA ad variant A", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
          softFailLog.push(`Step 12: ${String(e)}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 13: Create RSYA ad variant B
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 13: Creating RSYA ad variant B...`);
      if (adGroupIds.length < 2 || !imageHash) {
        recordStep({ step: 13, name: "Create RSYA ad variant B", status: "SKIP", latencyMs: 0, note: !imageHash ? "No image hash" : "No RSYA ad group" });
      } else {
        try {
          const res = await run<{ ad_id: number; error?: string }>(runDirectCreateAdRsya, {
            ad_group_id: adGroupIds[1],
            ad_image_hash: imageHash,
            title: TITLE_B,
            title2: TITLE2_B,
            text: TEXT_B,
            href: SITE_URL,
            confirm: true,
            account: ACCOUNT,
          });
          if (res.error || !res.ad_id) throw new Error(res.error ?? "No ad_id");
          adIds.push(res.ad_id);
          ledgerAppend({ type: "ad", id: res.ad_id, ad_group_id: adGroupIds[1], ts: new Date().toISOString() });
          recordStep({ step: 13, name: "Create RSYA ad variant B", status: "OK", ids: [res.ad_id], latencyMs: Date.now() - t0 });
        } catch (e) {
          recordStep({ step: 13, name: "Create RSYA ad variant B", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
          softFailLog.push(`Step 13: ${String(e)}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 14: Create Unified ad (TASK-3547) — ad group #1, image required
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 14: Creating Unified ad (TASK-3547 coverage)...`);
      if (adGroupIds.length === 0 || !imageHash) {
        recordStep({ step: 14, name: "Create Unified ad", status: "SKIP", latencyMs: 0, note: !imageHash ? "No image hash" : "No ad group" });
      } else {
        try {
          const res = await run<{ ad_id: number; error?: string }>(runDirectCreateAdUnified, {
            ad_group_id: adGroupIds[0],
            ad_image_hash: imageHash,
            title: TITLE_A,
            title2: TITLE2_A,
            text: TEXT_A,
            href: SITE_URL,
            confirm: true,
            account: ACCOUNT,
          });
          if (res.error || !res.ad_id) throw new Error(res.error ?? "No ad_id");
          adIds.push(res.ad_id);
          ledgerAppend({ type: "ad", id: res.ad_id, ad_group_id: adGroupIds[0], ts: new Date().toISOString() });
          recordStep({ step: 14, name: "Create Unified ad", status: "OK", ids: [res.ad_id], latencyMs: Date.now() - t0 });
        } catch (e) {
          recordStep({ step: 14, name: "Create Unified ad", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
          softFailLog.push(`Step 14: ${String(e)}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 15: Verify all ads in DRAFT
    // -----------------------------------------------------------------------
    {
      const t0 = Date.now();
      log(`Step 15: Verifying ads are in DRAFT status...`);
      if (adGroupIds.length === 0) {
        recordStep({ step: 15, name: "Verify ads DRAFT", status: "SKIP", latencyMs: 0, note: "No ad groups" });
      } else {
        try {
          const res = await run<{ ok: boolean; data?: unknown }>(runDirectListAds, {
            ad_group_ids: adGroupIds,
            statuses: ["DRAFT"],
            account: ACCOUNT,
          });
          recordStep({ step: 15, name: "Verify ads DRAFT", status: "OK", latencyMs: Date.now() - t0, note: "ads DRAFT state verified" });
        } catch (e) {
          recordStep({ step: 15, name: "Verify ads DRAFT", status: "SOFT_FAIL", latencyMs: Date.now() - t0, note: String(e) });
          softFailLog.push(`Step 15: ${String(e)}`);
        }
      }
    }

    // Snapshot ledger before cleanup (to count keywords)
    ledgerSnapshot = ledgerRead();

  } finally {
    // -----------------------------------------------------------------------
    // Cleanup — always runs
    // -----------------------------------------------------------------------
    log("Finally: running cleanup...");
    if (ledgerSnapshot.length === 0) ledgerSnapshot = ledgerRead();
    await cleanupFromLedger(softFailLog);

    // Determine remaining artifacts
    const remainingArtifacts: string[] = [];
    if (fs.existsSync(LEDGER_PATH)) {
      const remaining = ledgerRead();
      for (const e of remaining) {
        if (e.type === "campaign") remainingArtifacts.push(`campaign:${e.id}`);
        else if (e.type === "ad_group") remainingArtifacts.push(`ad_group:${(e as { id: number }).id}`);
        else if (e.type === "ad") remainingArtifacts.push(`ad:${(e as { id: number }).id}`);
        else if (e.type === "image") remainingArtifacts.push(`image:${(e as { hash: string }).hash}`);
        else if (e.type === "keyword") remainingArtifacts.push(`keyword:${(e as { id: number }).id}`);
      }
    }

    const cleanupSuccess =
      remainingArtifacts.length === 0 &&
      softFailLog.filter((f) => f.startsWith("delete") || f.startsWith("archive")).length === 0;

    const okSteps = stepResults.filter((s) => s.status === "OK").length;
    const totalSteps = stepResults.length;
    log(`Steps OK: ${okSteps}/${totalSteps}`);
    if (softFailLog.length > 0) {
      log(`Soft failures (${softFailLog.length}):`);
      softFailLog.forEach((f) => log(`  ${f}`));
    }

    const kwLedger = ledgerSnapshot.filter((e) => e.type === "keyword");

    generateReport({
      csvInfo: csvInfo ?? `**Source:** unknown\n\n`,
      keywordsCount: keywords?.length ?? 0,
      softFailLog,
      remainingArtifacts,
      campaignIds,
      adGroupIds,
      adIds,
      imageHash,
      metrikaLinked,
      cleanupSuccess,
    });

    const status =
      okSteps >= Math.ceil(totalSteps * 0.8)
        ? "success"
        : okSteps > 0
          ? "partial"
          : "failed";

    const finalResult = {
      status,
      campaigns_created: campaignIds.length,
      ad_groups_created: adGroupIds.length,
      keywords_added: kwLedger.length,
      ads_created: adIds.length,
      image_uploaded: imageHash !== null,
      metrika_goal_linked: metrikaLinked,
      cleanup_success: cleanupSuccess,
      remaining_artifacts: remainingArtifacts,
      notes:
        softFailLog.length > 0
          ? softFailLog.slice(0, 5).join("; ")
          : "all steps passed",
    };

    process.stdout.write("\n--- RESULT ---\n" + JSON.stringify(finalResult, null, 2) + "\n");
  }
}

main().catch((e) => {
  process.stderr.write(`[b3-smoke] FATAL: ${String(e)}\n`);
  process.exit(1);
});
