/**
 * fix-direct-final-reupload.ts — Production reupload of 10 broken draft campaigns.
 *
 * SAFE BY DEFAULT: no API calls are made unless RUN_LIVE=true.
 *
 * When RUN_LIVE=true, the script:
 *   1. DELETE PREFLIGHT: verifies all 10 target IDs exist, are DRAFT, and have expected names.
 *      If ANY check fails → ABORT (no deletes, no uploads).
 *   2. DELETE: removes the 10 broken draft campaigns.
 *   3. REUPLOAD SEARCH: uploads all 5 groups as "GCE-Поиск-Скрубберы" (dedupe_by_name=true).
 *   4. REUPLOAD RSYA:   uploads all 5 groups as "GCE-РСЯ-Скрубберы"  (dedupe_by_name=true).
 *   5. VERIFY: campaigns.get both, confirm names + budgets + ads exist.
 *   6. Print final JSON { deleted: [...10 ids], created: [{id,name},{id,name}] }.
 *   These campaigns STAY (production — no self-delete).
 */

// ---------------------------------------------------------------------------
// Bootstrap: load env BEFORE any DB-dependent import
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, cpSync } from "fs";
import * as nodePath from "path";
import * as yaml from "js-yaml";

const claudeJsonPath = nodePath.join(process.env["HOME"] ?? "/root", ".claude.json");
const cfg = JSON.parse(readFileSync(claudeJsonPath, "utf8")) as {
  mcpServers: Record<string, { env: Record<string, string> }>;
};

process.env["MCP_YANDEX_SEO_MASTER_KEY"] =
  cfg.mcpServers["mcp-yandex-seo"].env["MCP_YANDEX_SEO_MASTER_KEY"];
process.env["MCP_YANDEX_SEO_DB_PATH"] =
  cfg.mcpServers["mcp-yandex-seo"].env["MCP_YANDEX_SEO_DB_PATH"];

const LIVE = process.env["RUN_LIVE"] === "true";
if (LIVE) {
  process.env["OHMY_SEO_ALLOW_LIVE_MUTATIONS"] = "true";
  process.env["YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS"] = "true";
  process.env["YANDEX_DIRECT_ALLOW_DELETE"] = "true";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCOUNT = "yandex-direct-prod-main";

const SEARCH_BUNDLE =
  "/home/ubuntu/ads/gas-cleaning-equipment.com/docs/campaigns/gce-direct-5-clusters/deliverables/bundles/search";
const RSYA_BUNDLE =
  "/home/ubuntu/ads/gas-cleaning-equipment.com/docs/campaigns/gce-direct-5-clusters/deliverables/bundles/rsya";

const SEARCH_CAMPAIGN_NAME = "GCE-Поиск-Скрубберы";
const RSYA_CAMPAIGN_NAME   = "GCE-РСЯ-Скрубберы";

/** The 10 broken draft campaign IDs to delete (preflight-verified before deletion). */
const TARGET_IDS: number[] = [
  710117401, 710117410, 710117420, 710117434, 710117449,
  710117477, 710117484, 710117491, 710117502, 710117507,
];

/**
 * Expected name pattern for each broken draft.
 * They were created as "cluster-N" variants from the broken upload pipeline.
 * Regex: starts with "cluster-" or contains the substring, case-insensitive.
 */
const BROKEN_NAME_PATTERN = /cluster[-\s]?\d+/i;

/** All group YAML filenames present in both bundles. */
const GROUP_FILES = [
  "group-cl01-skrubber-eto.yaml",
  "group-cl04-rukavnyy-filtr.yaml",
  "group-cl06-pyleulovitel.yaml",
  "group-cl08-skrubber-venturi.yaml",
  "group-cl13-skrubber-vozduh.yaml",
];

const TS = Date.now();

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stdout.write(`[final-reupload] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UploadFn = (
  input: Record<string, unknown>
) => Promise<{ content?: Array<{ type: string } & Record<string, unknown>> }>;

type ExecuteApiFn = (input: {
  apiName: string;
  endpoint: string;
  method?: string;
  body?: unknown;
  account?: string;
}) => Promise<{ ok: boolean; data?: unknown; body?: unknown }>;

interface DryRunResult {
  plan_hash: string;
  expected_ack_live: string;
}

interface LiveResult {
  campaign_id: number | null;
  ad_group_ids: number[];
  ad_ids: number[];
}

interface PreflightEntry {
  id: number;
  exists: boolean;
  status: string | null;
  name: string | null;
  pass: boolean;
  failReason: string | null;
}

// ---------------------------------------------------------------------------
// Safe JSON parser
// ---------------------------------------------------------------------------

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Temp folder builder — copies all group files + patched _campaign.yaml
// ---------------------------------------------------------------------------

function buildTempFolder(
  sourceBundle: string,
  campaignName: string,
  suffix: string
): string {
  const tempDir = `/tmp/gce-final-reupload-${suffix}-${TS}`;
  mkdirSync(tempDir, { recursive: true });

  // Copy _campaign.yaml and all group files
  cpSync(
    nodePath.join(sourceBundle, "_campaign.yaml"),
    nodePath.join(tempDir, "_campaign.yaml")
  );
  for (const groupFile of GROUP_FILES) {
    cpSync(
      nodePath.join(sourceBundle, groupFile),
      nodePath.join(tempDir, groupFile)
    );
  }

  // Patch _campaign.yaml
  const raw = readFileSync(nodePath.join(tempDir, "_campaign.yaml"), "utf8");
  const parsed = yaml.load(raw) as Record<string, unknown>;
  parsed["upload_strategy"] = "single-campaign";
  parsed["dedupe_by_name"] = true;
  const campaign = parsed["campaign"] as Record<string, unknown>;
  campaign["Name"] = campaignName;
  // StartDate at least 2 days from now (MSK safety margin)
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 2);
  campaign["StartDate"] = startDate.toISOString().slice(0, 10);

  writeFileSync(
    nodePath.join(tempDir, "_campaign.yaml"),
    yaml.dump(parsed, { lineWidth: 120 }),
    "utf8"
  );

  log(`Temp folder: ${tempDir}`);
  log(`Campaign name: ${campaignName}`);
  return tempDir;
}

// ---------------------------------------------------------------------------
// DELETE PREFLIGHT (codex critical #4)
// Fetches all 10 target campaigns and verifies each:
//   - exists on the account
//   - Status === "DRAFT"
//   - Name matches BROKEN_NAME_PATTERN
// Returns preflight entries; caller decides whether to abort.
// ---------------------------------------------------------------------------

async function runDeletePreflight(
  executeApiCall: ExecuteApiFn
): Promise<PreflightEntry[]> {
  log("=== DELETE PREFLIGHT ===");
  log(`Fetching ${TARGET_IDS.length} target campaigns: ${TARGET_IDS.join(", ")}`);

  const res = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/campaigns",
    method: "POST",
    body: {
      method: "get",
      params: {
        SelectionCriteria: { Ids: TARGET_IDS },
        FieldNames: ["Id", "Name", "Status"],
      },
    },
    account: ACCOUNT,
  });

  if (!res.ok) {
    throw new Error(`Preflight campaigns.get failed: ${JSON.stringify(res.body)}`);
  }

  type CampItem = { Id?: number; Name?: string; Status?: string };
  const campaigns = (res.data as { result?: { Campaigns?: CampItem[] } })?.result?.Campaigns ?? [];
  const byId = new Map<number, CampItem>();
  for (const c of campaigns) {
    if (c.Id != null) byId.set(c.Id, c);
  }

  const entries: PreflightEntry[] = TARGET_IDS.map((id) => {
    const found = byId.get(id);
    if (!found) {
      return { id, exists: false, status: null, name: null, pass: false, failReason: "NOT FOUND on account" };
    }
    const status = found.Status ?? null;
    const name   = found.Name   ?? null;
    const isDraft   = status === "DRAFT";
    const nameOk    = name != null && BROKEN_NAME_PATTERN.test(name);
    const pass      = isDraft && nameOk;
    let failReason: string | null = null;
    if (!isDraft) failReason = `Status="${status}" (expected DRAFT)`;
    else if (!nameOk) failReason = `Name="${name}" does not match broken pattern`;
    return { id, exists: true, status, name, pass, failReason };
  });

  for (const e of entries) {
    const verdict = e.pass ? "PASS" : `FAIL — ${e.failReason}`;
    log(`  ID ${e.id}: name="${e.name}" status=${e.status} → ${verdict}`);
  }

  return entries;
}

// ---------------------------------------------------------------------------
// DELETE: remove the 10 target campaigns
// ---------------------------------------------------------------------------

async function deleteTargetCampaigns(
  executeApiCall: ExecuteApiFn,
  ids: number[]
): Promise<void> {
  log(`=== DELETE ${ids.length} campaigns ===`);
  const res = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/campaigns",
    method: "POST",
    body: {
      method: "delete",
      params: { SelectionCriteria: { Ids: ids } },
    },
    account: ACCOUNT,
  });

  if (!res.ok) {
    throw new Error(`campaigns.delete failed: ${JSON.stringify(res.body)}`);
  }

  type DeleteResult = { Errors?: unknown[] };
  type DeleteResponse = { DeleteResults?: DeleteResult[] };
  const deleteResults = (res.data as { result?: DeleteResponse })?.result?.DeleteResults ?? [];

  let hasErrors = false;
  for (let i = 0; i < deleteResults.length; i++) {
    const dr = deleteResults[i];
    if (dr.Errors && (dr.Errors as unknown[]).length > 0) {
      log(`  Delete error for index ${i} (id=${ids[i]}): ${JSON.stringify(dr.Errors)}`);
      hasErrors = true;
    }
  }
  if (hasErrors) {
    throw new Error("campaigns.delete returned errors for one or more IDs");
  }

  log(`  Deleted ${ids.length} campaigns successfully.`);
}

// ---------------------------------------------------------------------------
// DRY RUN
// ---------------------------------------------------------------------------

async function runDryRun(
  runDirectUploadFromYaml: UploadFn,
  tempDir: string,
  label: string
): Promise<DryRunResult> {
  log(`[${label}] Running dry-run ...`);
  const result = await runDirectUploadFromYaml({
    folder: tempDir,
    account: ACCOUNT,
    dry_run: true,
  });

  const firstContent = result.content?.[0];
  if (!firstContent || !("text" in firstContent)) {
    throw new Error(`[${label}] No text content in dry-run result`);
  }
  const rawText = String((firstContent as Record<string, unknown>)["text"]);
  const payload = safeJsonParse(rawText);
  if (!payload) {
    throw new Error(`[${label}] Dry-run response is not valid JSON: ${rawText.slice(0, 200)}`);
  }
  if (payload["error"]) {
    throw new Error(`[${label}] Dry-run error: ${JSON.stringify(payload)}`);
  }

  const pipelineResult = payload["pipeline_result"] as Record<string, unknown>;
  const planHash        = String(pipelineResult?.["plan_hash"]        ?? "");
  const expectedAckLive = String(pipelineResult?.["expected_ack_live"] ?? "");

  if (!planHash || !expectedAckLive) {
    throw new Error(
      `[${label}] Dry-run missing plan_hash or expected_ack_live: ${JSON.stringify(pipelineResult)}`
    );
  }

  log(`[${label}] plan_hash=${planHash}`);
  log(`[${label}] expected_ack_live=${expectedAckLive}`);

  return { plan_hash: planHash, expected_ack_live: expectedAckLive };
}

// ---------------------------------------------------------------------------
// Parse upload response helper
// ---------------------------------------------------------------------------

function parseUploadResponse(
  raw: { content?: Array<{ type: string } & Record<string, unknown>> },
  label: string
): Record<string, unknown> {
  const content = raw.content?.[0];
  if (!content || !("text" in content)) {
    throw new Error(`[${label}] No text content in upload response`);
  }
  const rawText = String((content as Record<string, unknown>)["text"]);
  const payload = safeJsonParse(rawText);
  if (!payload) {
    throw new Error(`[${label}] Upload response is not valid JSON: ${rawText.slice(0, 200)}`);
  }
  if (payload["error"]) {
    throw new Error(`[${label}] Upload error: ${JSON.stringify(payload["error"])}`);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// LIVE UPLOAD (Stage 1 canary + optional Stage 2 continuation)
// ---------------------------------------------------------------------------

async function runLiveUpload(
  runDirectUploadFromYaml: UploadFn,
  tempDir: string,
  planHash: string,
  acknowledgeLive: string,
  label: string,
  onCampaignCreated?: (id: number) => void
): Promise<LiveResult> {
  log(`[${label}] Running LIVE Stage 1 (canary) ...`);

  const stage1Raw = await runDirectUploadFromYaml({
    folder: tempDir,
    account: ACCOUNT,
    dry_run: false,
    confirm: true,
    acknowledge_live: acknowledgeLive,
    plan_hash: planHash,
  });

  const stage1Payload  = parseUploadResponse(stage1Raw, label);
  const stage1Pipeline = stage1Payload["pipeline_result"] as Record<string, unknown>;
  const stage1Stage    = String(stage1Pipeline?.["stage"] ?? "");

  log(`[${label}] Stage 1 stage: ${stage1Stage}`);
  log(`[${label}] campaigns_created: ${JSON.stringify(stage1Pipeline?.["campaigns_created"])}`);
  log(`[${label}] ad_groups_created: ${JSON.stringify(stage1Pipeline?.["ad_groups_created"])}`);
  log(`[${label}] ads_created:       ${JSON.stringify(stage1Pipeline?.["ads_created"])}`);
  log(`[${label}] errors:            ${JSON.stringify(stage1Pipeline?.["errors"])}`);

  if (stage1Stage === "canary_aborted") {
    throw new Error(`[${label}] Canary aborted: ${JSON.stringify(stage1Pipeline?.["errors"])}`);
  }

  const s1Campaigns = stage1Pipeline?.["campaigns_created"] as number[] | undefined ?? [];
  const s1Groups    = stage1Pipeline?.["ad_groups_created"] as number[] | undefined ?? [];
  const s1Ads       = stage1Pipeline?.["ads_created"]       as number[] | undefined ?? [];

  // Notify caller as early as possible (so cleanup can reference ID even if stage 2 fails)
  if (s1Campaigns[0] != null && onCampaignCreated) {
    onCampaignCreated(s1Campaigns[0]);
  }

  if (stage1Stage === "completed") {
    log(`[${label}] Stage 1 completed all groups — no Stage 2 needed.`);
    return {
      campaign_id:    s1Campaigns[0] ?? null,
      ad_group_ids:   s1Groups,
      ad_ids:         s1Ads,
    };
  }

  // canary_passed — Stage 2 needed
  const continuationAck = String(stage1Pipeline?.["expected_continuation_ack"] ?? "");
  if (!continuationAck) {
    throw new Error(`[${label}] Stage 1 did not return expected_continuation_ack`);
  }
  log(`[${label}] Running LIVE Stage 2 (continuation_ack=${continuationAck}) ...`);

  const stage2Raw = await runDirectUploadFromYaml({
    folder: tempDir,
    account: ACCOUNT,
    dry_run: false,
    confirm: true,
    acknowledge_live: acknowledgeLive,
    plan_hash: planHash,
    canary_passed: true,
    continuation_ack: continuationAck,
  });

  const stage2Payload  = parseUploadResponse(stage2Raw, label);
  const stage2Pipeline = stage2Payload["pipeline_result"] as Record<string, unknown>;

  log(`[${label}] Stage 2 stage: ${String(stage2Pipeline?.["stage"] ?? "")}`);
  log(`[${label}] Stage 2 campaigns_created: ${JSON.stringify(stage2Pipeline?.["campaigns_created"])}`);

  const s2Campaigns = stage2Pipeline?.["campaigns_created"] as number[] | undefined ?? [];
  const s2Groups    = stage2Pipeline?.["ad_groups_created"] as number[] | undefined ?? [];
  const s2Ads       = stage2Pipeline?.["ads_created"]       as number[] | undefined ?? [];

  return {
    campaign_id:  [...s1Campaigns, ...s2Campaigns][0] ?? null,
    ad_group_ids: [...s1Groups,    ...s2Groups],
    ad_ids:       [...s1Ads,       ...s2Ads],
  };
}

// ---------------------------------------------------------------------------
// VERIFY: campaigns.get + ads.get for a freshly created campaign
// ---------------------------------------------------------------------------

async function verifyCampaign(
  executeApiCall: ExecuteApiFn,
  campaignId: number,
  expectedName: string,
  label: string
): Promise<{ nameOk: boolean; budgetPresent: boolean; adCount: number }> {
  log(`[${label}] Verifying campaign ${campaignId} ...`);

  type CampItem = {
    Id?: number; Name?: string; Status?: string;
    DailyBudget?: { Amount?: number };
  };
  const campRes = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/campaigns",
    method: "POST",
    body: {
      method: "get",
      params: {
        SelectionCriteria: { Ids: [campaignId] },
        FieldNames: ["Id", "Name", "Status", "DailyBudget"],
        TextCampaignFieldNames: ["BiddingStrategy"],
      },
    },
    account: ACCOUNT,
  });

  if (!campRes.ok) {
    throw new Error(`[${label}] campaigns.get failed: ${JSON.stringify(campRes.body)}`);
  }
  const campaigns = (campRes.data as { result?: { Campaigns?: CampItem[] } })?.result?.Campaigns ?? [];
  const camp = campaigns.find((c) => c.Id === campaignId);
  if (!camp) {
    throw new Error(`[${label}] Campaign ${campaignId} not found in verification`);
  }

  log(`[${label}] campaign: ${JSON.stringify(camp)}`);
  const nameOk        = camp.Name === expectedName;
  const budgetPresent = camp.DailyBudget?.Amount != null;
  log(`[${label}] nameOk=${nameOk}, budgetPresent=${budgetPresent}`);

  // ads.get
  type AdItem = { Id?: number; Type?: string; State?: string };
  const adsRes = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/ads",
    method: "POST",
    body: {
      method: "get",
      params: {
        SelectionCriteria: { CampaignIds: [campaignId] },
        FieldNames: ["Id", "Type", "State"],
      },
    },
    account: ACCOUNT,
  });

  let adCount = 0;
  if (adsRes.ok) {
    const ads = (adsRes.data as { result?: { Ads?: AdItem[] } })?.result?.Ads ?? [];
    adCount = ads.length;
    for (const ad of ads) {
      log(`[${label}] ad ${ad.Id} Type=${ad.Type} State=${ad.State}`);
    }
  } else {
    log(`[${label}] ads.get failed: ${JSON.stringify(adsRes.body)}`);
  }

  log(`[${label}] adCount=${adCount}`);
  return { nameOk, budgetPresent, adCount };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log("=== fix-direct-final-reupload ===");
  log(`LIVE=${LIVE}, account=${ACCOUNT}`);
  log(`TARGET_IDS: ${TARGET_IDS.join(", ")}`);

  // -------------------------------------------------------------------------
  // GUARD: exit 0 without any API calls if not in live mode
  // -------------------------------------------------------------------------
  if (!LIVE) {
    log(
      "DRY MODE: would delete [" + TARGET_IDS.join(", ") + "], " +
      `would create ${SEARCH_CAMPAIGN_NAME} + ${RSYA_CAMPAIGN_NAME}. ` +
      "Set RUN_LIVE=true to execute."
    );
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // Live path starts here — import pipeline tools
  // -------------------------------------------------------------------------
  const { runDirectUploadFromYaml } = await import("../src/tools/direct-upload-from-yaml.js");
  const { executeApiCall }          = await import("../src/lib/api-gateway.js");

  const executeApi = executeApiCall as ExecuteApiFn;
  const uploadFn   = runDirectUploadFromYaml as UploadFn;

  // -------------------------------------------------------------------------
  // STEP 1: DELETE PREFLIGHT
  // -------------------------------------------------------------------------
  const preflightEntries = await runDeletePreflight(executeApi);
  const failed = preflightEntries.filter((e) => !e.pass);

  if (failed.length > 0) {
    log("\nPREFLIGHT FAILED — aborting. The following IDs did not pass:");
    for (const e of failed) {
      log(`  ID ${e.id}: ${e.failReason ?? "unknown reason"}`);
    }
    log("No campaigns were deleted or uploaded.");
    process.exitCode = 1;
    return;
  }

  log("Preflight PASSED for all 10 IDs — proceeding to delete.");

  // -------------------------------------------------------------------------
  // STEP 2: DELETE
  // -------------------------------------------------------------------------
  await deleteTargetCampaigns(executeApi, TARGET_IDS);

  // -------------------------------------------------------------------------
  // STEP 3: REUPLOAD SEARCH
  // -------------------------------------------------------------------------
  log("\n=== REUPLOAD SEARCH ===");
  let searchCampaignId: number | null = null;

  const searchTempDir = buildTempFolder(SEARCH_BUNDLE, SEARCH_CAMPAIGN_NAME, "search");
  const searchDry     = await runDryRun(uploadFn, searchTempDir, "SEARCH");

  const searchLive = await runLiveUpload(
    uploadFn, searchTempDir,
    searchDry.plan_hash, searchDry.expected_ack_live,
    "SEARCH",
    (id) => { searchCampaignId = id; }
  );
  if (searchLive.campaign_id != null) searchCampaignId = searchLive.campaign_id;

  if (!searchCampaignId) {
    throw new Error("SEARCH upload did not return a campaign ID");
  }
  log(`[SEARCH] campaign_id=${searchCampaignId}`);

  // -------------------------------------------------------------------------
  // STEP 4: REUPLOAD RSYA
  // -------------------------------------------------------------------------
  log("\n=== REUPLOAD RSYA ===");
  let rsyaCampaignId: number | null = null;

  const rsyaTempDir = buildTempFolder(RSYA_BUNDLE, RSYA_CAMPAIGN_NAME, "rsya");
  const rsyaDry     = await runDryRun(uploadFn, rsyaTempDir, "RSYA");

  const rsyaLive = await runLiveUpload(
    uploadFn, rsyaTempDir,
    rsyaDry.plan_hash, rsyaDry.expected_ack_live,
    "RSYA",
    (id) => { rsyaCampaignId = id; }
  );
  if (rsyaLive.campaign_id != null) rsyaCampaignId = rsyaLive.campaign_id;

  if (!rsyaCampaignId) {
    throw new Error("RSYA upload did not return a campaign ID");
  }
  log(`[RSYA] campaign_id=${rsyaCampaignId}`);

  // -------------------------------------------------------------------------
  // STEP 5: VERIFY
  // -------------------------------------------------------------------------
  log("\n=== VERIFY ===");
  const searchVerify = await verifyCampaign(executeApi, searchCampaignId, SEARCH_CAMPAIGN_NAME, "SEARCH");
  const rsyaVerify   = await verifyCampaign(executeApi, rsyaCampaignId,   RSYA_CAMPAIGN_NAME,   "RSYA");

  const verifyOk =
    searchVerify.nameOk &&
    searchVerify.adCount > 0 &&
    rsyaVerify.nameOk &&
    rsyaVerify.adCount > 0;

  if (!verifyOk) {
    log("VERIFY ISSUES:");
    if (!searchVerify.nameOk)   log(`  SEARCH name mismatch (expected="${SEARCH_CAMPAIGN_NAME}")`);
    if (searchVerify.adCount === 0) log("  SEARCH: 0 ads returned");
    if (!rsyaVerify.nameOk)     log(`  RSYA name mismatch (expected="${RSYA_CAMPAIGN_NAME}")`);
    if (rsyaVerify.adCount === 0)   log("  RSYA: 0 ads returned");
  }

  // -------------------------------------------------------------------------
  // STEP 6: FINAL JSON
  // -------------------------------------------------------------------------
  const finalReport = {
    deleted: TARGET_IDS,
    created: [
      { id: searchCampaignId, name: SEARCH_CAMPAIGN_NAME },
      { id: rsyaCampaignId,   name: RSYA_CAMPAIGN_NAME   },
    ],
    verify: {
      search: searchVerify,
      rsya:   rsyaVerify,
    },
  };

  log("\n=== FINAL REPORT ===");
  log(JSON.stringify(finalReport, null, 2));

  if (!verifyOk) {
    process.exitCode = 1;
    log("RESULT: COMPLETED WITH VERIFY WARNINGS (see above)");
  } else {
    log("RESULT: SUCCESS — campaigns created and verified.");
  }
}

main().catch((e) => {
  process.stderr.write(`[final-reupload] FATAL: ${String(e)}\n`);
  if (e instanceof Error && e.stack) {
    process.stderr.write(e.stack + "\n");
  }
  process.exit(1);
});
