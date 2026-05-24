/**
 * c-real-upload.ts — Real CSV upload to Yandex Direct. NO cleanup.
 *
 * Runs the 3-stage upload pipeline against test_direct.csv.
 * Drafts REMAIN in the Direct cabinet for manual inspection.
 * Recovery command is printed at the end — run it only when you're done checking.
 *
 * Account: yandex-direct-prod-main (login ki.vech)
 * CSV: /home/ubuntu/downloads/test_direct.csv
 * max_clusters: 3
 */

// ---------------------------------------------------------------------------
// Bootstrap: load env BEFORE any DB-dependent import
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import * as nodePath from "path";
import { fileURLToPath } from "url";

const claudeJsonPath = nodePath.join(process.env["HOME"] ?? "/root", ".claude.json");
const cfg = JSON.parse(readFileSync(claudeJsonPath, "utf8")) as {
  mcpServers: Record<string, { env: Record<string, string> }>;
};
process.env["MCP_YANDEX_SEO_MASTER_KEY"] =
  cfg.mcpServers["mcp-yandex-seo"].env["MCP_YANDEX_SEO_MASTER_KEY"];
process.env["MCP_YANDEX_SEO_DB_PATH"] =
  cfg.mcpServers["mcp-yandex-seo"].env["MCP_YANDEX_SEO_DB_PATH"];
process.env["OHMY_SEO_ALLOW_LIVE_MUTATIONS"] = "true";
process.env["YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS"] = "true";

// ---------------------------------------------------------------------------
// Safe to import DB-dependent modules now
// ---------------------------------------------------------------------------

import { uploadCampaignBundle } from "../src/lib/upload-pipeline.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCOUNT = "yandex-direct-prod-main";
const CSV_PATH = "/home/ubuntu/downloads/test_direct.csv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = nodePath.dirname(__filename);
const REPO_ROOT = nodePath.resolve(__dirname, "..", "..", "..");

const REPORT_DIR = nodePath.join(
  REPO_ROOT,
  "docs",
  "plans",
  "phase-3-5-c-csv-upload-pipeline"
);
const REPORT_PATH = nodePath.join(REPORT_DIR, "real-upload-output.md");

const TS = new Date().toISOString();

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stdout.write(`[c-real-upload] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Common pipeline params
// ---------------------------------------------------------------------------

type Result = Awaited<ReturnType<typeof uploadCampaignBundle>>;

const COMMON = {
  csv_path: CSV_PATH,
  campaign_strategy: { mode: "one-per-cluster" as const },
  campaign_type: "search" as const,
  site_url: "https://vechkasov.ru",
  daily_budget_rub: 100,
  region_ids: [213],
  bidding_strategy_type: "HIGHEST_POSITION" as const,
  metrika_counter_ids: [54918634],
  metrika_goal_ids: [254644847],
  ads_per_group: 2,
  ad_template_strategy: "fallback-template" as const,
  canary_percent: 30,
  max_clusters: 3,
  abort_on_error_rate: 0.5,
  account: ACCOUNT,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`Starting. TS=${TS}`);
  log(`Account: ${ACCOUNT}, CSV: ${CSV_PATH}, max_clusters: ${COMMON.max_clusters}`);
  log("NOTE: drafts will remain in Direct cabinet — no cleanup will run.");

  // -------------------------------------------------------------------------
  // Stage 0 — Dry-run
  // -------------------------------------------------------------------------
  log("\n=== Stage 0: dry-run ===");
  const dry: Result = await uploadCampaignBundle({ ...COMMON, dry_run: true });
  log(`plan_hash: ${dry.plan_hash}`);
  log(`expected_ack_live: ${dry.expected_ack_live}`);
  log(`total_clusters: ${dry.total_clusters}`);

  if (!dry.plan_hash) throw new Error("Stage 0: missing plan_hash");
  if (!dry.expected_ack_live) throw new Error("Stage 0: missing expected_ack_live");

  const planHash = dry.plan_hash;
  const expectedAckLive = dry.expected_ack_live;

  // -------------------------------------------------------------------------
  // Stage 1 — Canary
  // -------------------------------------------------------------------------
  log("\n=== Stage 1: canary ===");
  const canary: Result = await uploadCampaignBundle({
    ...COMMON,
    dry_run: false,
    plan_hash: planHash,
    confirm: true,
    acknowledge_live: expectedAckLive,
  });
  log(`canary_passed: ${canary.canary_passed}`);
  log(`campaigns so far: ${JSON.stringify(canary.campaigns_created)}`);
  log(`ad_groups so far: ${JSON.stringify(canary.ad_groups_created)}`);
  log(`ads so far: ${JSON.stringify(canary.ads_created)}`);
  log(`ledger: ${canary.ledger_path}`);

  if (!canary.canary_passed) {
    log("CANARY FAILED — drafts may remain partially. Inspect ledger and cabinet.");
    log(`Ledger path: ${canary.ledger_path}`);
    log(`Errors: ${JSON.stringify(canary.errors)}`);
    process.exit(1);
  }

  if (!canary.expected_continuation_ack) {
    throw new Error("Stage 1: missing expected_continuation_ack");
  }

  const continuationAck = canary.expected_continuation_ack;
  const ledgerPath = canary.ledger_path;

  // -------------------------------------------------------------------------
  // Stage 2 — Continuation
  // -------------------------------------------------------------------------
  log("\n=== Stage 2: continuation ===");
  const final: Result = await uploadCampaignBundle({
    ...COMMON,
    dry_run: false,
    plan_hash: planHash,
    confirm: true,
    acknowledge_live: expectedAckLive,
    canary_passed: true,
    continuation_ack: continuationAck,
  });
  log(`status: ${final.stage}`);
  log(`campaigns_created: ${JSON.stringify(final.campaigns_created)}`);
  log(`ad_groups_created: ${JSON.stringify(final.ad_groups_created)}`);
  log(`keywords_added: ${final.keywords_added}`);
  log(`ads_created: ${JSON.stringify(final.ads_created)}`);
  log(`metrika_linked: ${final.metrika_linked}`);
  log(`errors: ${JSON.stringify(final.errors)}`);

  const activeLedgerPath = final.ledger_path || ledgerPath;

  // -------------------------------------------------------------------------
  // Merge all campaign IDs across both stages
  // -------------------------------------------------------------------------
  const allCampaignIds = Array.from(
    new Set([...canary.campaigns_created, ...final.campaigns_created])
  );

  // -------------------------------------------------------------------------
  // Summary section — NO cleanup
  // -------------------------------------------------------------------------
  const cleanupCmd = `cd /home/ubuntu/tools/ohmy-seo && npx tsx packages/yandex-seo/scripts/bundle-recovery.ts --ledger ${activeLedgerPath} --account ${ACCOUNT}`;

  log("\n=== DRAFTS LEFT IN CABINET — NO CLEANUP ===");
  log(`Campaign IDs: ${JSON.stringify(allCampaignIds)}`);
  log(`Direct UI: https://direct.yandex.ru`);
  log(`Filter by name prefix: phase-3-5-c-test_`);
  log(`Ledger: ${activeLedgerPath}`);
  log(`To clean up later:\n  ${cleanupCmd}`);

  // -------------------------------------------------------------------------
  // Write report
  // -------------------------------------------------------------------------
  const report = `# Real CSV upload — drafts left in cabinet

**Timestamp:** ${TS}
**Account:** ${ACCOUNT} (ki.vech)
**Source CSV:** ${CSV_PATH}
**Max clusters:** ${COMMON.max_clusters} (first ${COMMON.max_clusters} from CSV)

## Result
- Status: ${final.stage}
- Campaigns created: ${JSON.stringify(allCampaignIds)}
- Ad groups: ${JSON.stringify(final.ad_groups_created)}
- Keywords added: ${final.keywords_added}
- Ads created: ${JSON.stringify(final.ads_created)}
- Metrika linked: ${final.metrika_linked}
- Errors: ${JSON.stringify(final.errors)}

## Where to see them
- Direct UI: https://direct.yandex.ru → Drafts / All campaigns
- Filter campaigns by name prefix \`phase-3-5-c-test_\`

## How to clean up later
\`\`\`bash
${cleanupCmd}
\`\`\`

## Ledger
${activeLedgerPath}
`;

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, report, "utf8");
  log(`\nReport written to ${REPORT_PATH}`);
}

main().catch((e) => {
  process.stderr.write(`[c-real-upload] FATAL: ${String(e)}\n`);
  process.exit(1);
});
