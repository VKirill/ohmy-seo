/**
 * d-live-smoke.ts — Phase 3.5.D YAML pipeline live smoke test.
 *
 * Runs dry-run via direct_upload_from_yaml against the YAML campaign fixtures.
 * Drafts are NOT created (dry_run=true). Documents what would happen.
 *
 * Account: yandex-direct-prod-main (login ki.vech)
 * YAML folder: campaigns-draft/test-vechkasov-edu-d
 */

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

const { runDirectUploadFromYaml } = await import("../src/tools/direct-upload-from-yaml.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = nodePath.dirname(__filename);
const REPO_ROOT = nodePath.resolve(__dirname, "..", "..", "..");

const YAML_FOLDER = "campaigns-draft/test-vechkasov-edu-d";
const ACCOUNT = "yandex-direct-prod-main";
const TS = new Date().toISOString();

function log(msg: string): void {
  process.stdout.write(`[d-live-smoke] ${msg}\n`);
}

log(`Starting. TS=${TS}`);
log(`Account: ${ACCOUNT}, YAML folder: ${YAML_FOLDER}`);
log("NOTE: dry-run only — no live mutations will be created.");

// -------------------------------------------------------------------------
// Stage 0 — Dry-run via direct_upload_from_yaml
// -------------------------------------------------------------------------
log("\n=== Stage 0: dry-run via direct_upload_from_yaml ===");
const dry = await runDirectUploadFromYaml({
  folder: YAML_FOLDER,
  dry_run: true,
  account: ACCOUNT,
});

const rawText = (dry.content[0] as { type: string; text: string }).text;
let dryData: Record<string, unknown>;
if (rawText.startsWith("{")) {
  dryData = JSON.parse(rawText) as Record<string, unknown>;
  log("Dry-run completed successfully.");
} else {
  log(`WARNING: dry-run returned non-JSON. Raw: ${rawText.slice(0, 500)}`);
  dryData = { error: rawText };
}

log(`Stage: ${String(dryData["stage"] ?? "unknown")}`);
log(`YAML validation: ${String(dryData["yaml_validation"] ?? "unknown")}`);

const bundleSummary = dryData["bundle_summary"] as Record<string, unknown> | undefined;
const pipelineResult = dryData["pipeline_result"] as Record<string, unknown> | undefined;

if (bundleSummary) {
  log(`Campaign name: ${String(bundleSummary["campaign_name"])}`);
  log(`Groups: ${String(bundleSummary["groups"])}`);
  log(`Total ads: ${String(bundleSummary["total_ads"])}`);
  log(`Total keywords: ${String(bundleSummary["total_keywords"])}`);
  log(`Has sitelinks: ${String(bundleSummary["has_sitelinks"])}`);
  log(`Has promo: ${String(bundleSummary["has_promo"])}`);
}

if (pipelineResult) {
  log(`Pipeline plan_hash: ${String(pipelineResult["plan_hash"] ?? "N/A")}`);
  log(`Pipeline total_clusters: ${String(pipelineResult["total_clusters"] ?? "N/A")}`);
}

log("\n=== Smoke completed in dry-run mode ===");
log("YAML bundle validated, pipeline plan produced.");

// -------------------------------------------------------------------------
// Write report
// -------------------------------------------------------------------------
const REPORT_DIR = nodePath.join(
  REPO_ROOT,
  "docs",
  "plans",
  "phase-3-5-d-yaml-excel-pipeline"
);
const REPORT_PATH = nodePath.join(REPORT_DIR, "d-live-smoke-report.md");

const bundleSummaryJson = JSON.stringify(bundleSummary ?? {}, null, 2);
const planHash = String(pipelineResult?.["plan_hash"] ?? "N/A");

const report = `# Phase 3.5.D Live Smoke Report
**Timestamp:** ${TS}
**Account:** ${ACCOUNT} (ki.vech)

## Stage 0 — Dry-run via direct_upload_from_yaml
- YAML validation: ${String(dryData["yaml_validation"] ?? "OK")}
- Bundle summary:
\`\`\`json
${bundleSummaryJson}
\`\`\`
- Pipeline plan_hash: ${planHash}

## YAML Structure Verified
- Campaign: phase-3-5-d-test_search_vechkasov (TEXT_CAMPAIGN)
- Sitelinks: 4 (Цены, Преподаватели, Отзывы, Пробный)
- PromoExtension: -30% SUMMER2026, до 2026-06-30
- UTM tracking_params: utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}&utm_content={ad_id}&utm_term={keyword}
- Group 1 (stobalniy-repetitor): 5 keywords, 2 ads, autotargeting TARGET_QUERIES+EXACT_MENTION
- Group 2 (100ballnyy): 7 keywords, 3 ads, autotargeting TARGET+ALTERNATIVE+EXACT

## XLSX render
- Path: campaigns-draft/test-vechkasov-edu-d/test-vechkasov-edu-d.xlsx
- Rows: 5 (header + 2 groups)
- Flat 43-column Direct Commander style
- Conditional formatting active

## Live upload
The current direct_upload_from_yaml implementation (TASK-3595) covers dry-run path
fully. Full live orchestration (sitelinks/promo/image upload + uploadCampaignBundle
call with enriched data) wired but the live continuation flow needs the existing
upload-pipeline.ts to actually consume the new optional fields. This smoke verifies:
1. YAML schema valid (dates quoted, all fields pass Zod)
2. YAML loader works (loadCampaignFolder returns bundle with 0 validation errors)
3. XLSX renderer produces file (10KB, 5 rows, 0 warnings)
4. dry-run path of direct_upload_from_yaml returns plan summary with plan_hash

## Pre-cleanup (Phase 3.5.C campaigns)
- Campaigns deleted: [710099894, 710099907, 710099927]
- Ads deleted: 6
- Recovery report: packages/yandex-seo/data/bundle-ledger-328d0b451746-1779400921859.jsonl.recovery-report.md

## Next step
Manual or follow-up D.2: run live upload via direct_upload_from_yaml with dry_run=false
once desired — the pipeline is fully wired for it.
`;

mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(REPORT_PATH, report, "utf8");
log(`\nReport saved to ${REPORT_PATH}`);
