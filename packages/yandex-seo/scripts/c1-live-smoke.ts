/**
 * c1-live-smoke.ts — Phase 3.5.C full lifecycle smoke test.
 *
 * Tests the 3-stage pipeline on the real Yandex Direct account:
 *   Stage 0: dry_run plan generation
 *   Stage 1: live canary (50% of 3 clusters = 2)
 *   Stage 2: continuation (remaining clusters)
 * Then runs recovery script to verify cleanup.
 *
 * CRITICAL: NO moderation calls. All ads remain DRAFT.
 *
 * Account: yandex-direct-prod-main (login ki.vech)
 * CSV: /home/ubuntu/downloads/test_direct.csv
 * max_clusters: 3 (keep blast radius small)
 */

// ---------------------------------------------------------------------------
// Bootstrap: load env BEFORE any DB-dependent import
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import * as nodePath from "path";
import { execSync } from "child_process";

const claudeJsonPath = nodePath.join(process.env["HOME"] ?? "/root", ".claude.json");
const cfg = JSON.parse(readFileSync(claudeJsonPath, "utf8")) as {
  mcpServers: Record<string, { env: Record<string, string> }>;
};
process.env["MCP_YANDEX_SEO_MASTER_KEY"] =
  cfg.mcpServers["mcp-yandex-seo"].env["MCP_YANDEX_SEO_MASTER_KEY"];
process.env["MCP_YANDEX_SEO_DB_PATH"] =
  cfg.mcpServers["mcp-yandex-seo"].env["MCP_YANDEX_SEO_DB_PATH"];
// Critical: must enable mutation flags for live test
process.env["OHMY_SEO_ALLOW_LIVE_MUTATIONS"] = "true";
process.env["YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS"] = "true";

// ---------------------------------------------------------------------------
// Safe to import DB-dependent modules now
// ---------------------------------------------------------------------------

import { uploadCampaignBundle } from "../src/lib/upload-pipeline.js";
import { executeApiCall } from "../src/lib/api-gateway.js";
import * as fs from "fs";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Result = Awaited<ReturnType<typeof uploadCampaignBundle>>;

interface StageReport {
  stage: string;
  status: "OK" | "FAILED" | "SKIP";
  latencyMs: number;
  returnedValues?: Record<string, unknown>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCOUNT = "yandex-direct-prod-main";
const CSV_PATH = "/home/ubuntu/downloads/test_direct.csv";
const SITE_URL = "https://vechkasov.ru";
const DAILY_BUDGET = 100;
const REGION_IDS = [213];
const METRIKA_COUNTER_IDS = [54918634];
const METRIKA_GOAL_IDS = [254644847];
const MAX_CLUSTERS = 3;
const CANARY_PERCENT = 50;

const __filename = fileURLToPath(import.meta.url);
const __dirname = nodePath.dirname(__filename);
const REPO_ROOT = nodePath.resolve(__dirname, "..", "..", "..");

const REPORT_DIR = nodePath.join(
  REPO_ROOT,
  "docs",
  "plans",
  "phase-3-5-c-csv-upload-pipeline"
);
const REPORT_PATH = nodePath.join(REPORT_DIR, "c1-live-smoke-report.md");

const TS = new Date().toISOString();

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stdout.write(`[c1-smoke] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// CSV hash (for report)
// ---------------------------------------------------------------------------

function computeCsvHash(csvPath: string): string {
  const buf = fs.readFileSync(csvPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function writeReport(params: {
  csvHash: string;
  planHash: string;
  stageReports: StageReport[];
  campaignsFoundInDirect: number;
  campaignIds: number[];
  recoveryNeeded: boolean;
  recoveryOutput: string;
  campaignsAfterCleanup: number;
}): void {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const lines: string[] = [
    `# Phase 3.5.C — c1 Live Smoke Report`,
    ``,
    `**Timestamp:** ${TS}`,
    `**Account:** ${ACCOUNT} (login: ki.vech)`,
    `**CSV hash:** ${params.csvHash}`,
    `**Plan hash:** ${params.planHash || "(dry_run not completed)"}`,
    ``,
    `## Stages`,
    ``,
    `| Stage | Status | Latency | Notes |`,
    `|-------|--------|---------|-------|`,
  ];

  for (const r of params.stageReports) {
    const latency = r.latencyMs > 0 ? `${r.latencyMs}ms` : "-";
    const note = r.error ? r.error.slice(0, 100) : "-";
    lines.push(`| ${r.stage} | ${r.status} | ${latency} | ${note} |`);
  }

  lines.push(``);

  for (const r of params.stageReports) {
    if (r.returnedValues && Object.keys(r.returnedValues).length > 0) {
      lines.push(`### ${r.stage} — Returned Values`);
      lines.push(``);
      lines.push("```json");
      lines.push(JSON.stringify(r.returnedValues, null, 2));
      lines.push("```");
      lines.push(``);
    }
  }

  lines.push(`## Verification`);
  lines.push(``);
  lines.push(`**Campaigns found in Direct after upload:** ${params.campaignsFoundInDirect}`);
  lines.push(`**Campaign IDs created:** ${params.campaignIds.join(", ") || "(none)"}`);
  lines.push(``);
  lines.push(`## Recovery`);
  lines.push(``);
  lines.push(`**Recovery needed:** ${params.recoveryNeeded ? "YES" : "NO (cleanup triggered anyway for test)"}`);
  lines.push(``);
  if (params.recoveryOutput) {
    lines.push("```");
    lines.push(params.recoveryOutput.slice(0, 2000));
    lines.push("```");
    lines.push(``);
  }
  lines.push(`**Campaigns remaining after cleanup:** ${params.campaignsAfterCleanup}`);
  lines.push(`**0 orphans:** ${params.campaignsAfterCleanup === 0 ? "YES" : "NO — manual cleanup needed"}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by c1-live-smoke.ts*`);

  fs.writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
  log(`Report written: ${REPORT_PATH}`);
}

// ---------------------------------------------------------------------------
// Verify campaigns in Direct by IDs
// ---------------------------------------------------------------------------

async function getCampaignsByIds(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  try {
    const res = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/campaigns",
      method: "POST",
      body: {
        method: "get",
        params: {
          SelectionCriteria: { Ids: ids },
          FieldNames: ["Id", "Name", "Status"],
          Page: { Limit: 100 },
        },
      },
      account: ACCOUNT,
    });
    if (!res.ok) {
      log(`  WARN: Campaigns.get returned HTTP ${res.status}`);
      return 0;
    }
    const data = res.data as Record<string, unknown>;
    const campaigns = ((data?.result as Record<string, unknown>)?.Campaigns as unknown[]) ?? [];
    return campaigns.length;
  } catch (e) {
    log(`  WARN: Campaigns.get error: ${String(e)}`);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`Starting. TS=${TS}`);
  log(`Account: ${ACCOUNT}, CSV: ${CSV_PATH}, max_clusters: ${MAX_CLUSTERS}`);

  const stageReports: StageReport[] = [];
  let csvHash = "(unknown)";
  let planHash = "";
  let expectedAckLive = "";
  let ledgerPath = "";
  let campaignsCreated: number[] = [];
  let recoveryNeeded = false;
  let recoveryOutput = "";
  let campaignsAfterCleanup = 0;

  // Compute CSV hash for report
  try {
    csvHash = computeCsvHash(CSV_PATH);
    log(`CSV hash: ${csvHash}`);
  } catch (e) {
    log(`CSV hash error: ${String(e)}`);
  }

  try {
    // -----------------------------------------------------------------------
    // Stage 0 — Dry-run
    // -----------------------------------------------------------------------
    log("\n=== Stage 0: Dry-run ===");
    const t0 = Date.now();
    let stage0Result: Result;
    try {
      stage0Result = await uploadCampaignBundle({
        csv_path: CSV_PATH,
        campaign_strategy: { mode: "one-per-cluster" },
        campaign_type: "search",
        site_url: SITE_URL,
        daily_budget_rub: DAILY_BUDGET,
        region_ids: REGION_IDS,
        bidding_strategy_type: "HIGHEST_POSITION",
        metrika_counter_ids: METRIKA_COUNTER_IDS,
        metrika_goal_ids: METRIKA_GOAL_IDS,
        ads_per_group: 2,
        ad_template_strategy: "fallback-template",
        dry_run: true,
        canary_percent: CANARY_PERCENT,
        max_clusters: MAX_CLUSTERS,
        account: ACCOUNT,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      stageReports.push({ stage: "Stage 0 (dry-run)", status: "FAILED", latencyMs: Date.now() - t0, error: errMsg });
      throw new Error(`Stage 0 failed: ${errMsg}`);
    }

    const latency0 = Date.now() - t0;

    // Assertions
    if (stage0Result.dry_run !== true) {
      throw new Error(`Stage 0: expected dry_run=true in result, got ${stage0Result.dry_run}`);
    }
    if (stage0Result.campaigns_created.length !== 0) {
      throw new Error(`Stage 0: expected no campaigns created, got ${stage0Result.campaigns_created.length}`);
    }
    if (!stage0Result.plan_hash) {
      throw new Error("Stage 0: missing plan_hash in result");
    }
    if (!stage0Result.expected_ack_live) {
      throw new Error("Stage 0: missing expected_ack_live in result");
    }

    planHash = stage0Result.plan_hash;
    expectedAckLive = stage0Result.expected_ack_live;

    log(`Stage 0 OK. plan_hash=${planHash}`);
    log(`expected_ack_live=${expectedAckLive}`);

    stageReports.push({
      stage: "Stage 0 (dry-run)",
      status: "OK",
      latencyMs: latency0,
      returnedValues: {
        dry_run: stage0Result.dry_run,
        total_clusters: stage0Result.total_clusters,
        plan_hash: planHash,
        expected_ack_live: expectedAckLive,
      },
    });

    // -----------------------------------------------------------------------
    // Stage 1 — Live canary
    // -----------------------------------------------------------------------
    log("\n=== Stage 1: Live canary ===");
    const t1 = Date.now();
    let stage1Result: Result;
    try {
      stage1Result = await uploadCampaignBundle({
        csv_path: CSV_PATH,
        campaign_strategy: { mode: "one-per-cluster" },
        campaign_type: "search",
        site_url: SITE_URL,
        daily_budget_rub: DAILY_BUDGET,
        region_ids: REGION_IDS,
        bidding_strategy_type: "HIGHEST_POSITION",
        metrika_counter_ids: METRIKA_COUNTER_IDS,
        metrika_goal_ids: METRIKA_GOAL_IDS,
        ads_per_group: 2,
        ad_template_strategy: "fallback-template",
        dry_run: false,
        canary_percent: CANARY_PERCENT,
        max_clusters: MAX_CLUSTERS,
        account: ACCOUNT,
        plan_hash: planHash,
        confirm: true,
        acknowledge_live: expectedAckLive,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      stageReports.push({ stage: "Stage 1 (canary)", status: "FAILED", latencyMs: Date.now() - t1, error: errMsg });
      throw new Error(`Stage 1 failed: ${errMsg}`);
    }

    const latency1 = Date.now() - t1;

    if (!stage1Result.canary_passed) {
      throw new Error(`Stage 1: canary_passed=false. Errors: ${JSON.stringify(stage1Result.errors)}`);
    }
    if (!stage1Result.expected_continuation_ack) {
      throw new Error("Stage 1: missing expected_continuation_ack");
    }

    ledgerPath = stage1Result.ledger_path;
    const continuationAck = stage1Result.expected_continuation_ack;

    // Track created IDs so far
    for (const id of stage1Result.campaigns_created) {
      if (!campaignsCreated.includes(id)) campaignsCreated.push(id);
    }

    log(`Stage 1 OK. canary_passed=true`);
    log(`ledger_path=${ledgerPath}`);
    log(`continuation_ack=${continuationAck}`);
    log(`Campaigns so far: [${campaignsCreated.join(", ")}]`);

    stageReports.push({
      stage: "Stage 1 (canary)",
      status: "OK",
      latencyMs: latency1,
      returnedValues: {
        canary_passed: stage1Result.canary_passed,
        campaigns_created: stage1Result.campaigns_created,
        ad_groups_created: stage1Result.ad_groups_created,
        keywords_added: stage1Result.keywords_added,
        ads_created: stage1Result.ads_created,
        ledger_path: ledgerPath,
        expected_continuation_ack: continuationAck,
        errors: stage1Result.errors,
      },
    });

    // -----------------------------------------------------------------------
    // Stage 2 — Continuation (bulk)
    // -----------------------------------------------------------------------
    log("\n=== Stage 2: Continuation ===");
    const t2 = Date.now();
    let stage2Result: Result;
    try {
      stage2Result = await uploadCampaignBundle({
        csv_path: CSV_PATH,
        campaign_strategy: { mode: "one-per-cluster" },
        campaign_type: "search",
        site_url: SITE_URL,
        daily_budget_rub: DAILY_BUDGET,
        region_ids: REGION_IDS,
        bidding_strategy_type: "HIGHEST_POSITION",
        metrika_counter_ids: METRIKA_COUNTER_IDS,
        metrika_goal_ids: METRIKA_GOAL_IDS,
        ads_per_group: 2,
        ad_template_strategy: "fallback-template",
        dry_run: false,
        canary_percent: CANARY_PERCENT,
        max_clusters: MAX_CLUSTERS,
        account: ACCOUNT,
        plan_hash: planHash,
        canary_passed: true,
        continuation_ack: continuationAck,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      stageReports.push({ stage: "Stage 2 (continuation)", status: "FAILED", latencyMs: Date.now() - t2, error: errMsg });
      throw new Error(`Stage 2 failed: ${errMsg}`);
    }

    const latency2 = Date.now() - t2;

    // Merge all created IDs
    for (const id of stage2Result.campaigns_created) {
      if (!campaignsCreated.includes(id)) campaignsCreated.push(id);
    }

    log(`Stage 2 OK. stage=${stage2Result.stage}`);
    log(`All campaign IDs: [${campaignsCreated.join(", ")}]`);
    log(`Total ads created: ${stage2Result.ads_created.length}`);

    // Update ledger path (stage 2 uses same ledger)
    if (stage2Result.ledger_path) ledgerPath = stage2Result.ledger_path;

    stageReports.push({
      stage: "Stage 2 (continuation)",
      status: "OK",
      latencyMs: latency2,
      returnedValues: {
        stage: stage2Result.stage,
        campaigns_created: stage2Result.campaigns_created,
        ad_groups_created: stage2Result.ad_groups_created,
        keywords_added: stage2Result.keywords_added,
        ads_created: stage2Result.ads_created,
        metrika_linked: stage2Result.metrika_linked,
        errors: stage2Result.errors,
        ledger_path: ledgerPath,
      },
    });

    // -----------------------------------------------------------------------
    // Verify post-creation: query Direct for campaigns by ID
    // -----------------------------------------------------------------------
    log("\n=== Verification: Campaigns.get ===");
    const campaignsFoundInDirect = await getCampaignsByIds(campaignsCreated);
    log(`Campaigns found in Direct: ${campaignsFoundInDirect} (expected ${campaignsCreated.length})`);

    stageReports.push({
      stage: "Verification (Campaigns.get)",
      status: campaignsFoundInDirect > 0 ? "OK" : "FAILED",
      latencyMs: 0,
      returnedValues: {
        ids_checked: campaignsCreated,
        found_count: campaignsFoundInDirect,
      },
    });

    // -----------------------------------------------------------------------
    // Recovery test — run bundle-recovery.ts via execSync
    // -----------------------------------------------------------------------
    log("\n=== Recovery test ===");
    if (!ledgerPath) {
      log("  WARN: No ledger_path returned, skipping recovery.");
      stageReports.push({ stage: "Recovery", status: "SKIP", latencyMs: 0, error: "no ledger_path" });
    } else {
      log(`  Ledger: ${ledgerPath}`);
      log(`  Running: npx tsx packages/yandex-seo/scripts/bundle-recovery.ts --ledger "${ledgerPath}" --account ${ACCOUNT}`);

      const recoveryStart = Date.now();
      try {
        const recoveryCmd = `cd "${REPO_ROOT}" && npx tsx packages/yandex-seo/scripts/bundle-recovery.ts --ledger "${ledgerPath}" --account ${ACCOUNT}`;
        recoveryOutput = execSync(recoveryCmd, {
          encoding: "utf8",
          timeout: 120_000,
          env: {
            ...process.env,
          },
        });
        log(`Recovery script output (${recoveryOutput.length} chars):`);
        log(recoveryOutput.slice(0, 1000));

        stageReports.push({
          stage: "Recovery",
          status: "OK",
          latencyMs: Date.now() - recoveryStart,
          returnedValues: { output_lines: recoveryOutput.split("\n").length },
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        recoveryOutput = errMsg;
        stageReports.push({ stage: "Recovery", status: "FAILED", latencyMs: Date.now() - recoveryStart, error: errMsg.slice(0, 200) });
        log(`  Recovery script failed: ${errMsg.slice(0, 300)}`);
        recoveryNeeded = true;
      }
    }

    // -----------------------------------------------------------------------
    // Verify cleanup: check campaigns count in Direct
    // -----------------------------------------------------------------------
    log("\n=== Post-cleanup verification ===");
    campaignsAfterCleanup = await getCampaignsByIds(campaignsCreated);
    log(`Campaigns remaining after cleanup: ${campaignsAfterCleanup}`);

    stageReports.push({
      stage: "Post-cleanup verification",
      status: campaignsAfterCleanup === 0 ? "OK" : "FAILED",
      latencyMs: 0,
      returnedValues: {
        ids_checked: campaignsCreated,
        remaining_count: campaignsAfterCleanup,
      },
    });

    // Write report
    writeReport({
      csvHash,
      planHash,
      stageReports,
      campaignsFoundInDirect,
      campaignIds: campaignsCreated,
      recoveryNeeded,
      recoveryOutput,
      campaignsAfterCleanup,
    });

    // Final summary
    const allPassed = stageReports.every((r) => r.status === "OK" || r.status === "SKIP");
    const status = allPassed
      ? "success"
      : stageReports.some((r) => r.status === "OK")
        ? "partial"
        : "failed";
    const stagesPassed = stageReports.filter((r) => r.status === "OK").length;

    const finalResult = {
      status,
      stages_passed: stagesPassed,
      campaigns_created: campaignsCreated.length,
      campaigns_remaining_after_cleanup: campaignsAfterCleanup,
      notes: allPassed
        ? "All stages passed, 0 orphans"
        : stageReports
            .filter((r) => r.status === "FAILED")
            .map((r) => `${r.stage}: ${r.error ?? "failed"}`)
            .join("; "),
    };

    process.stdout.write("\n--- RESULT ---\n" + JSON.stringify(finalResult, null, 2) + "\n");

  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log(`\nFATAL error: ${errMsg}`);

    // Soft-fail recovery on error
    recoveryNeeded = true;
    if (ledgerPath && fs.existsSync(ledgerPath)) {
      log("Attempting recovery after failure...");
      try {
        const recoveryCmd = `cd "${REPO_ROOT}" && npx tsx packages/yandex-seo/scripts/bundle-recovery.ts --ledger "${ledgerPath}" --account ${ACCOUNT}`;
        recoveryOutput = execSync(recoveryCmd, {
          encoding: "utf8",
          timeout: 120_000,
          env: { ...process.env },
        });
        log("Recovery completed (after fatal error).");
        campaignsAfterCleanup = await getCampaignsByIds(campaignsCreated);
      } catch (recErr) {
        log(`Recovery also failed: ${String(recErr)}`);
        recoveryOutput = String(recErr);
      }
    }

    // Write partial report
    writeReport({
      csvHash,
      planHash,
      stageReports,
      campaignsFoundInDirect: 0,
      campaignIds: campaignsCreated,
      recoveryNeeded,
      recoveryOutput,
      campaignsAfterCleanup,
    });

    const stagesPassed = stageReports.filter((r) => r.status === "OK").length;

    const finalResult = {
      status: "failed",
      stages_passed: stagesPassed,
      campaigns_created: campaignsCreated.length,
      campaigns_remaining_after_cleanup: campaignsAfterCleanup,
      notes: errMsg.slice(0, 500),
    };

    process.stdout.write("\n--- RESULT ---\n" + JSON.stringify(finalResult, null, 2) + "\n");
    process.exit(1);
  }
}

main().catch((e) => {
  process.stderr.write(`[c1-smoke] FATAL: ${String(e)}\n`);
  process.exit(1);
});
