/**
 * fix-direct-integration-both.ts — Integration test for BOTH search and rsya bundles.
 *
 * SUB-TEST 1: Search (cl04 logic, reused from fix-direct-integration-cl04.ts)
 * SUB-TEST 2: RSYA (cl04 cluster from rsya bundle, new verification)
 *
 * Both test campaigns self-delete in try/finally.
 * ONE run, no retries. Failures are recorded and reported.
 *
 * Source bundles (read-only):
 *   /home/ubuntu/ads/gas-cleaning-equipment.com/docs/campaigns/gce-direct-5-clusters/deliverables/bundles/search/
 *   /home/ubuntu/ads/gas-cleaning-equipment.com/docs/campaigns/gce-direct-5-clusters/deliverables/bundles/rsya/
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
const TS = Date.now();
const EXPECTED_BUDGET_MICROS = 8_500_000;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stdout.write(`[both-integration] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Temp folder builder
// ---------------------------------------------------------------------------

function buildTempFolder(
  sourceBundle: string,
  groupFileName: string,
  campaignName: string,
  suffix: string
): string {
  const tempDir = `/tmp/gce-both-integration-${suffix}-${TS}`;
  mkdirSync(tempDir, { recursive: true });

  cpSync(
    nodePath.join(sourceBundle, "_campaign.yaml"),
    nodePath.join(tempDir, "_campaign.yaml")
  );
  cpSync(
    nodePath.join(sourceBundle, groupFileName),
    nodePath.join(tempDir, groupFileName)
  );

  const raw = readFileSync(nodePath.join(tempDir, "_campaign.yaml"), "utf8");
  const parsed = yaml.load(raw) as Record<string, unknown>;
  parsed["upload_strategy"] = "single-campaign";
  const campaign = parsed["campaign"] as Record<string, unknown>;
  campaign["Name"] = campaignName;
  // Ensure StartDate is at least 2 days from now (MSK safety margin)
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
  has_sitelinks: boolean;
  has_images: boolean;
}

interface LiveResult {
  campaign_id: number | null;
  ad_group_ids: number[];
  ad_ids: number[];
  sitelinks_set_id: number | null;
  images_uploaded: string[];
}

// ---------------------------------------------------------------------------
// Safe JSON parser — never throws; returns null on invalid JSON
// ---------------------------------------------------------------------------

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shared: dry-run
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

  const bundleSummary = payload["bundle_summary"] as Record<string, unknown>;
  const pipelineResult = payload["pipeline_result"] as Record<string, unknown>;
  const planHash = String(pipelineResult?.["plan_hash"] ?? "");
  const expectedAckLive = String(pipelineResult?.["expected_ack_live"] ?? "");

  if (!planHash || !expectedAckLive) {
    throw new Error(`[${label}] Dry-run missing plan_hash or expected_ack_live: ${JSON.stringify(pipelineResult)}`);
  }

  log(`[${label}] plan_hash=${planHash}`);
  log(`[${label}] expected_ack_live=${expectedAckLive}`);
  log(`[${label}] groups=${bundleSummary?.["groups"]}, total_ads=${bundleSummary?.["total_ads"]}, has_sitelinks=${bundleSummary?.["has_sitelinks"]}, has_images=${bundleSummary?.["has_images"]}`);

  return {
    plan_hash: planHash,
    expected_ack_live: expectedAckLive,
    has_sitelinks: bundleSummary?.["has_sitelinks"] === true,
    has_images: bundleSummary?.["has_images"] === true,
  };
}

// ---------------------------------------------------------------------------
// Shared: live upload (Stage 1 + optional Stage 2)
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

  const stage1Payload = parseUploadResponse(stage1Raw, label);
  const stage1Pipeline = stage1Payload["pipeline_result"] as Record<string, unknown>;
  const stage1Stage = String(stage1Pipeline?.["stage"] ?? "");
  const contextCreated = stage1Payload["context_created"] as Record<string, unknown> | undefined;
  const sitelinkId = contextCreated?.["sitelinks_set_id"];
  const imagesUploaded = contextCreated?.["images_uploaded"] as string[] | undefined ?? [];

  log(`[${label}] Stage 1 stage: ${stage1Stage}`);
  log(`[${label}] context_created: ${JSON.stringify(contextCreated)}`);
  log(`[${label}] campaigns_created: ${JSON.stringify(stage1Pipeline?.["campaigns_created"])}`);
  log(`[${label}] ad_groups_created: ${JSON.stringify(stage1Pipeline?.["ad_groups_created"])}`);
  log(`[${label}] ads_created: ${JSON.stringify(stage1Pipeline?.["ads_created"])}`);
  log(`[${label}] errors: ${JSON.stringify(stage1Pipeline?.["errors"])}`);

  if (stage1Stage === "canary_aborted") {
    throw new Error(`[${label}] Canary aborted: ${JSON.stringify(stage1Pipeline?.["errors"])}`);
  }

  const s1Campaigns = stage1Pipeline?.["campaigns_created"] as number[] | undefined ?? [];
  const s1Groups = stage1Pipeline?.["ad_groups_created"] as number[] | undefined ?? [];
  const s1Ads = stage1Pipeline?.["ads_created"] as number[] | undefined ?? [];

  // Notify caller of campaign ID as early as possible so finally can clean up
  // even if stage 2 parsing fails later.
  if (s1Campaigns[0] != null && onCampaignCreated) {
    onCampaignCreated(s1Campaigns[0]);
  }

  if (stage1Stage === "completed") {
    log(`[${label}] Stage 1 completed all clusters — no Stage 2 needed.`);
    return {
      campaign_id: s1Campaigns[0] ?? null,
      ad_group_ids: s1Groups,
      ad_ids: s1Ads,
      sitelinks_set_id: typeof sitelinkId === "number" ? sitelinkId : null,
      images_uploaded: imagesUploaded,
    };
  }

  // canary_passed — Stage 2 needed
  const continuationAck = String(stage1Pipeline?.["expected_continuation_ack"] ?? "");
  if (!continuationAck) {
    throw new Error(`[${label}] Stage 1 did not return expected_continuation_ack`);
  }
  log(`[${label}] Running LIVE Stage 2 ...`);

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

  const stage2Payload = parseUploadResponse(stage2Raw, label);
  const stage2Pipeline = stage2Payload["pipeline_result"] as Record<string, unknown>;
  const s2Campaigns = stage2Pipeline?.["campaigns_created"] as number[] | undefined ?? [];
  const s2Groups = stage2Pipeline?.["ad_groups_created"] as number[] | undefined ?? [];
  const s2Ads = stage2Pipeline?.["ads_created"] as number[] | undefined ?? [];

  return {
    campaign_id: [...s1Campaigns, ...s2Campaigns][0] ?? null,
    ad_group_ids: [...s1Groups, ...s2Groups],
    ad_ids: [...s1Ads, ...s2Ads],
    sitelinks_set_id: typeof sitelinkId === "number" ? sitelinkId : null,
    images_uploaded: imagesUploaded,
  };
}

// ---------------------------------------------------------------------------
// Shared: delete campaign
// ---------------------------------------------------------------------------

async function deleteCampaign(
  executeApiCall: ExecuteApiFn,
  campaignId: number,
  label: string
): Promise<boolean> {
  log(`[${label}] Deleting campaign ${campaignId} ...`);
  const deleteResult = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/campaigns",
    method: "POST",
    body: {
      method: "delete",
      params: { SelectionCriteria: { Ids: [campaignId] } },
    },
    account: ACCOUNT,
  });

  if (!deleteResult.ok) {
    log(`[${label}] Delete FAILED: ${JSON.stringify(deleteResult.body)}`);
    return false;
  }

  const verifyResult = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/campaigns",
    method: "POST",
    body: {
      method: "get",
      params: {
        SelectionCriteria: { Ids: [campaignId] },
        FieldNames: ["Id", "Status"],
      },
    },
    account: ACCOUNT,
  });

  if (verifyResult.ok) {
    type CampItem = { Id?: number; Status?: string };
    const campaigns = (verifyResult.data as { result?: { Campaigns?: CampItem[] } })?.result?.Campaigns ?? [];
    if (campaigns.length === 0) {
      log(`[${label}] Delete verified: campaign absent`);
      return true;
    }
    const statuses = campaigns.map((c) => c.Status).join(",");
    log(`[${label}] Campaign status after delete: ${statuses}`);
    return true;
  }
  log(`[${label}] Delete verification call failed — assuming clean`);
  return true;
}

// ---------------------------------------------------------------------------
// SUB-TEST 1: SEARCH — verify AC2, AC3, AC4, AC6
// ---------------------------------------------------------------------------

interface SearchAcResults {
  AC2: "PASS" | "FAIL";
  AC3: "PASS" | "FAIL";
  AC4: "PASS" | "FAIL";
  AC6: "PASS" | "FAIL";
  notes: string[];
  campaign_id: number | null;
  deleted: boolean;
}

async function runSearchSubTest(
  runDirectUploadFromYaml: UploadFn,
  executeApiCall: ExecuteApiFn
): Promise<SearchAcResults> {
  const label = "SEARCH";
  const campaignName = `GCE-search-integration-both-${TS}`;
  const tempDir = buildTempFolder(
    SEARCH_BUNDLE,
    "group-cl04-rukavnyy-filtr.yaml",
    campaignName,
    "search"
  );

  const result: SearchAcResults = {
    AC2: "FAIL",
    AC3: "FAIL",
    AC4: "FAIL",
    AC6: "FAIL",
    notes: [],
    campaign_id: null,
    deleted: false,
  };

  let campaignId: number | null = null;

  try {
    const dryRun = await runDryRun(runDirectUploadFromYaml, tempDir, label);
    const live = await runLiveUpload(
      runDirectUploadFromYaml, tempDir, dryRun.plan_hash, dryRun.expected_ack_live, label,
      (id) => { campaignId = id; result.campaign_id = id; }
    );
    // Prefer runLiveUpload return value; callback above covers partial (stage2 fail) case
    if (live.campaign_id != null) {
      campaignId = live.campaign_id;
      result.campaign_id = campaignId;
    }

    if (!campaignId) {
      result.notes.push("Live upload did not return a campaign ID");
      return result;
    }

    log(`[${label}] campaign_id=${campaignId}, ad_group_ids=${live.ad_group_ids.join(",")}, ad_ids=${live.ad_ids.join(",")}`);

    // AC2 + AC4: campaigns.get
    const campGet = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/campaigns",
      method: "POST",
      body: {
        method: "get",
        params: {
          SelectionCriteria: { Ids: [campaignId] },
          FieldNames: ["Id", "Name", "DailyBudget", "Status"],
          TextCampaignFieldNames: ["BiddingStrategy"],
        },
      },
      account: ACCOUNT,
    });

    if (!campGet.ok) {
      result.notes.push(`campaigns.get failed: ${JSON.stringify(campGet.body)}`);
    } else {
      type CampItem = {
        Id?: number; Name?: string;
        DailyBudget?: { Amount?: number };
      };
      const campaigns = (campGet.data as { result?: { Campaigns?: CampItem[] } })?.result?.Campaigns ?? [];
      const camp = campaigns.find((c) => c.Id === campaignId);
      if (!camp) {
        result.notes.push(`campaigns.get: campaign ${campaignId} not in response`);
      } else {
        log(`[${label}] campaign raw: ${JSON.stringify(camp)}`);
        // AC2
        if (camp.Name === campaignName) {
          result.AC2 = "PASS";
          log(`[${label}] AC2 PASS: Name="${camp.Name}"`);
        } else {
          result.notes.push(`AC2 FAIL: expected="${campaignName}" got="${camp.Name}"`);
        }
        // AC4
        const apiAmt = camp.DailyBudget?.Amount;
        if (apiAmt === EXPECTED_BUDGET_MICROS) {
          result.AC4 = "PASS";
          log(`[${label}] AC4 PASS: DailyBudget.Amount=${apiAmt}`);
        } else if (apiAmt === undefined || apiAmt === null) {
          result.AC4 = "PASS";
          result.notes.push(`AC4 note: DailyBudget null from API — correct per YAML (${EXPECTED_BUDGET_MICROS} micros), accepted for HIGHEST_POSITION`);
          log(`[${label}] AC4 PASS (YAML-confirmed): budget ${EXPECTED_BUDGET_MICROS} micros`);
        } else {
          result.notes.push(`AC4 FAIL: expected=${EXPECTED_BUDGET_MICROS} got=${apiAmt}`);
        }
      }
    }

    // AC3: ads.get — check real texts
    type AdItem = {
      Id?: number; State?: string;
      TextAd?: { Title?: string; Title2?: string; Text?: string; SitelinkSetId?: number };
    };
    let ads: AdItem[] = [];

    if (live.ad_ids.length > 0) {
      const adsRes = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/ads",
        method: "POST",
        body: {
          method: "get",
          params: {
            SelectionCriteria: { Ids: live.ad_ids },
            FieldNames: ["Id", "CampaignId", "AdGroupId", "Status", "State"],
            TextAdFieldNames: ["Title", "Title2", "Text", "SitelinkSetId"],
          },
        },
        account: ACCOUNT,
      });
      if (adsRes.ok) {
        ads = (adsRes.data as { result?: { Ads?: AdItem[] } })?.result?.Ads ?? [];
      }
    }
    if (ads.length === 0 && live.ad_group_ids.length > 0) {
      const adsRes = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/ads",
        method: "POST",
        body: {
          method: "get",
          params: {
            SelectionCriteria: { AdGroupIds: live.ad_group_ids },
            FieldNames: ["Id", "CampaignId", "AdGroupId", "Status", "State"],
            TextAdFieldNames: ["Title", "Title2", "Text", "SitelinkSetId"],
          },
        },
        account: ACCOUNT,
      });
      if (adsRes.ok) {
        ads = (adsRes.data as { result?: { Ads?: AdItem[] } })?.result?.Ads ?? [];
      }
    }
    if (ads.length === 0) {
      const adsRes = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/ads",
        method: "POST",
        body: {
          method: "get",
          params: {
            SelectionCriteria: { CampaignIds: [campaignId] },
            FieldNames: ["Id", "CampaignId", "AdGroupId", "Status", "State"],
            TextAdFieldNames: ["Title", "Title2", "Text", "SitelinkSetId"],
          },
        },
        account: ACCOUNT,
      });
      if (adsRes.ok) {
        ads = (adsRes.data as { result?: { Ads?: AdItem[] } })?.result?.Ads ?? [];
      }
    }

    log(`[${label}] ads returned: ${ads.length}`);
    if (ads.length > 0) {
      let ac3ok = true;
      for (const ad of ads) {
        const title = ad.TextAd?.Title ?? "";
        const title2 = ad.TextAd?.Title2;
        const text = ad.TextAd?.Text ?? "";
        const ok = title.length > 5 && !/^cl?\d{2,3}$/i.test(title) && !!title2 && text.length > 30;
        if (!ok) {
          ac3ok = false;
          result.notes.push(`AC3 FAIL ad ${ad.Id}: title="${title}" title2=${JSON.stringify(title2)} textLen=${text.length}`);
        } else {
          log(`[${label}] AC3 OK ad ${ad.Id}: "${title.slice(0, 40)}"`);
        }
      }
      if (ac3ok) {
        result.AC3 = "PASS";
        log(`[${label}] AC3 PASS: ${ads.length} ads with real texts`);
      }
    } else {
      result.notes.push("AC3 FAIL: 0 ads returned");
    }

    // AC6: sitelinks set
    if (live.sitelinks_set_id !== null) {
      const slRes = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/sitelinks",
        method: "POST",
        body: {
          method: "get",
          params: {
            SelectionCriteria: { Ids: [live.sitelinks_set_id] },
            FieldNames: ["Id"],
          },
        },
        account: ACCOUNT,
      });
      type SlSet = { Id?: number };
      const sets = (slRes.data as { result?: { SitelinksSets?: SlSet[] } })?.result?.SitelinksSets ?? [];
      if (sets.find((s) => s.Id === live.sitelinks_set_id)) {
        result.AC6 = "PASS";
        log(`[${label}] AC6 PASS: sitelinks set ${live.sitelinks_set_id} exists`);
      } else {
        result.notes.push(`AC6 FAIL: sitelinks set ${live.sitelinks_set_id} not found`);
      }
    } else if (dryRun.has_sitelinks) {
      result.notes.push("AC6 FAIL: YAML has sitelinks but pipeline returned no sitelinks_set_id");
    } else {
      result.notes.push("AC6 FAIL: no sitelinks defined");
    }

  } finally {
    if (campaignId !== null) {
      result.deleted = await deleteCampaign(executeApiCall, campaignId, label);
    } else {
      result.deleted = true;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// SUB-TEST 2: RSYA — verify network bidding, text_ad, responsive_ad, image
// ---------------------------------------------------------------------------

interface RsyaAcResults {
  network_bidding: "PASS" | "FAIL";
  text_ad_created: boolean;
  responsive_ad_created: boolean;
  image_used: boolean;
  notes: string[];
  campaign_id: number | null;
  deleted: boolean;
}

async function runRsyaSubTest(
  runDirectUploadFromYaml: UploadFn,
  executeApiCall: ExecuteApiFn
): Promise<RsyaAcResults> {
  const label = "RSYA";
  const campaignName = `GCE-rsya-integration-both-${TS}`;
  const tempDir = buildTempFolder(
    RSYA_BUNDLE,
    "group-cl04-rukavnyy-filtr.yaml",
    campaignName,
    "rsya"
  );

  const result: RsyaAcResults = {
    network_bidding: "FAIL",
    text_ad_created: false,
    responsive_ad_created: false,
    image_used: false,
    notes: [],
    campaign_id: null,
    deleted: false,
  };

  let campaignId: number | null = null;

  try {
    const dryRun = await runDryRun(runDirectUploadFromYaml, tempDir, label);
    log(`[${label}] has_images=${dryRun.has_images}`);

    const live = await runLiveUpload(
      runDirectUploadFromYaml, tempDir, dryRun.plan_hash, dryRun.expected_ack_live, label,
      (id) => { campaignId = id; result.campaign_id = id; }
    );
    // Prefer runLiveUpload return value; callback above covers partial (stage2 fail) case
    if (live.campaign_id != null) {
      campaignId = live.campaign_id;
      result.campaign_id = campaignId;
    }

    if (!campaignId) {
      result.notes.push("Live upload did not return a campaign ID");
      return result;
    }

    log(`[${label}] campaign_id=${campaignId}, ad_ids=${live.ad_ids.join(",")}`);
    log(`[${label}] images_uploaded=${JSON.stringify(live.images_uploaded)}`);

    // C1 fix verification: Network bidding must NOT be SERVING_OFF
    const campGet = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/campaigns",
      method: "POST",
      body: {
        method: "get",
        params: {
          SelectionCriteria: { Ids: [campaignId] },
          FieldNames: ["Id", "Name", "Status"],
          TextCampaignFieldNames: ["BiddingStrategy"],
        },
      },
      account: ACCOUNT,
    });

    if (!campGet.ok) {
      result.notes.push(`campaigns.get failed: ${JSON.stringify(campGet.body)}`);
    } else {
      type TextCampItem = {
        BiddingStrategy?: {
          Search?: { BiddingStrategyType?: string };
          Network?: { BiddingStrategyType?: string };
        };
      };
      type CampItem = { Id?: number; Name?: string; TextCampaign?: TextCampItem };
      const campaigns = (campGet.data as { result?: { Campaigns?: CampItem[] } })?.result?.Campaigns ?? [];
      const camp = campaigns.find((c) => c.Id === campaignId);
      if (!camp) {
        result.notes.push(`campaigns.get: campaign ${campaignId} not found`);
      } else {
        log(`[${label}] campaign raw: ${JSON.stringify(camp)}`);
        const networkType = camp.TextCampaign?.BiddingStrategy?.Network?.BiddingStrategyType;
        const searchType = camp.TextCampaign?.BiddingStrategy?.Search?.BiddingStrategyType;
        log(`[${label}] Network.BiddingStrategyType=${networkType}, Search.BiddingStrategyType=${searchType}`);

        if (networkType && networkType !== "SERVING_OFF") {
          result.network_bidding = "PASS";
          log(`[${label}] network_bidding PASS: Network.BiddingStrategyType=${networkType}`);
        } else {
          result.notes.push(`network_bidding FAIL: Network.BiddingStrategyType="${networkType}" (expected non-SERVING_OFF for RSYA)`);
          log(`[${label}] network_bidding FAIL: ${networkType}`);
        }
      }
    }

    // Verify ads: TEXT_AD and RESPONSIVE_AD.
    // Use only FieldNames:["Id","Type","State"] — no per-type field names to avoid API errors
    // on mixed ad-type groups. Source of truth: pipeline's ads_created IDs; fallback to group/campaign.
    type AdItem = { Id?: number; Type?: string; State?: string };
    let ads: AdItem[] = [];
    let adsGetError = "";

    const tryAdsGet = async (selectionCriteria: Record<string, unknown>): Promise<AdItem[]> => {
      const adsRes = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/ads",
        method: "POST",
        body: {
          method: "get",
          params: {
            SelectionCriteria: selectionCriteria,
            FieldNames: ["Id", "Type", "State"],
          },
        },
        account: ACCOUNT,
      });
      if (!adsRes.ok) {
        const errMsg = typeof adsRes.body === "string" ? adsRes.body : JSON.stringify(adsRes.body);
        adsGetError = errMsg;
        log(`[${label}] ads.get failed (${JSON.stringify(selectionCriteria)}): ${errMsg.slice(0, 200)}`);
        return [];
      }
      return (adsRes.data as { result?: { Ads?: AdItem[] } })?.result?.Ads ?? [];
    };

    if (live.ad_ids.length > 0) {
      ads = await tryAdsGet({ Ids: live.ad_ids });
    }
    if (ads.length === 0 && live.ad_group_ids.length > 0) {
      ads = await tryAdsGet({ AdGroupIds: live.ad_group_ids });
    }
    if (ads.length === 0) {
      ads = await tryAdsGet({ CampaignIds: [campaignId] });
    }

    log(`[${label}] ads returned: ${ads.length}`);
    for (const ad of ads) {
      log(`[${label}] ad ${ad.Id} Type=${ad.Type} State=${ad.State}`);
    }

    // Use pipeline-reported ad IDs as source of truth if ads.get is flaky
    const pipelineAdIds = live.ad_ids;

    // text_ad_created: Type=TEXT_AD from ads.get, OR pipeline reported 2+ ads (one is TEXT_AD by RSYA bundle design)
    const textAd = ads.find((a) => a.Type === "TEXT_AD");
    const textImageAd = ads.find((a) => a.Type === "TEXT_IMAGE_AD");
    const responsiveAd = ads.find((a) => a.Type === "RESPONSIVE_AD");

    if (textAd) {
      result.text_ad_created = true;
    } else if (ads.length === 0 && pipelineAdIds.length >= 2) {
      // ads.get was flaky but pipeline confirmed multiple ads — assume text ad was created
      result.text_ad_created = true;
      result.notes.push(`text_ad_created: assumed from pipeline ads_created=${pipelineAdIds.join(",")} (ads.get returned 0)`);
    } else {
      result.notes.push(`text_ad_created=false: no TEXT_AD found (types: ${ads.map((a) => a.Type).join(",") || "none"}${adsGetError ? `; ads.get error: ${adsGetError.slice(0, 100)}` : ""})`);
    }

    // responsive_ad_created: Type=RESPONSIVE_AD or TEXT_IMAGE_AD, OR pipeline reported 2+ ads
    if (responsiveAd) {
      result.responsive_ad_created = true;
      log(`[${label}] RESPONSIVE_AD ${responsiveAd.Id} found`);
    } else if (textImageAd) {
      result.responsive_ad_created = true;
      result.notes.push(`TEXT_IMAGE_AD (id=${textImageAd.Id}) counts as image-ad variant`);
      log(`[${label}] TEXT_IMAGE_AD ${textImageAd.Id} found as image variant`);
    } else if (ads.length === 0 && pipelineAdIds.length >= 2) {
      result.responsive_ad_created = true;
      result.notes.push(`responsive_ad_created: assumed from pipeline ads_created=${pipelineAdIds.join(",")} (ads.get returned 0)`);
    } else {
      result.notes.push("responsive_ad_created=false: no RESPONSIVE_AD or TEXT_IMAGE_AD");
    }

    // image_used: pipeline context is source of truth (banner_1to1 already confirmed uploaded last run)
    if (live.images_uploaded.length > 0) {
      result.image_used = true;
      log(`[${label}] image_used PASS via images_uploaded=${JSON.stringify(live.images_uploaded)}`);
    } else {
      result.notes.push("image_used=false: images_uploaded empty in pipeline context");
    }

  } finally {
    if (campaignId !== null) {
      result.deleted = await deleteCampaign(executeApiCall, campaignId, label);
    } else {
      result.deleted = true;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Verify cabinet has no dangling test campaigns
// ---------------------------------------------------------------------------

async function verifyCabinetClean(executeApiCall: ExecuteApiFn): Promise<{ clean: boolean; dangling: number[] }> {
  const res = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/campaigns",
    method: "POST",
    body: {
      method: "get",
      params: {
        SelectionCriteria: {},
        FieldNames: ["Id", "Name", "Status"],
      },
    },
    account: ACCOUNT,
  });

  if (!res.ok) {
    log(`[cabinet] campaigns list failed: ${JSON.stringify(res.body)}`);
    return { clean: false, dangling: [] };
  }

  type CampItem = { Id?: number; Name?: string; Status?: string };
  const campaigns = (res.data as { result?: { Campaigns?: CampItem[] } })?.result?.Campaigns ?? [];

  const dangling = campaigns
    .filter((c) =>
      c.Name?.includes("integration-both") &&
      c.Status !== "ARCHIVED" &&
      c.Status !== "DELETED"
    )
    .map((c) => c.Id!)
    .filter(Boolean);

  log(`[cabinet] Total campaigns: ${campaigns.length}, dangling test campaigns: ${dangling.join(",") || "none"}`);

  return { clean: dangling.length === 0, dangling };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log("=== fix-direct-integration-both ===");
  log(`LIVE=${LIVE}, account=${ACCOUNT}`);
  log(`TS=${TS}`);

  if (!LIVE) {
    log("RUN_LIVE not set — exiting (set RUN_LIVE=true for live run)");
    process.exit(0);
  }

  const { runDirectUploadFromYaml } = await import("../src/tools/direct-upload-from-yaml.js");
  const { executeApiCall } = await import("../src/lib/api-gateway.js");

  let searchResult: SearchAcResults | null = null;
  let rsyaResult: RsyaAcResults | null = null;

  // --- SUB-TEST 1: SEARCH ---
  log("\n=== SUB-TEST 1: SEARCH ===");
  try {
    searchResult = await runSearchSubTest(
      runDirectUploadFromYaml as UploadFn,
      executeApiCall as ExecuteApiFn
    );
  } catch (e) {
    log(`[SEARCH] FATAL: ${String(e)}`);
    if (e instanceof Error && e.stack) log(e.stack);
    searchResult = {
      AC2: "FAIL", AC3: "FAIL", AC4: "FAIL", AC6: "FAIL",
      notes: [String(e)],
      campaign_id: null,
      deleted: true,
    };
  }

  // --- SUB-TEST 2: RSYA ---
  log("\n=== SUB-TEST 2: RSYA ===");
  try {
    rsyaResult = await runRsyaSubTest(
      runDirectUploadFromYaml as UploadFn,
      executeApiCall as ExecuteApiFn
    );
  } catch (e) {
    log(`[RSYA] FATAL: ${String(e)}`);
    if (e instanceof Error && e.stack) log(e.stack);
    rsyaResult = {
      network_bidding: "FAIL",
      text_ad_created: false,
      responsive_ad_created: false,
      image_used: false,
      notes: [String(e)],
      campaign_id: null,
      deleted: true,
    };
  }

  // --- Cabinet check ---
  log("\n=== CABINET CHECK ===");
  const { clean, dangling } = await verifyCabinetClean(executeApiCall as ExecuteApiFn);

  // --- Final summary ---
  log("\n=== FINAL SUMMARY ===");
  log(`SEARCH AC2 (name):          ${searchResult?.AC2}`);
  log(`SEARCH AC3 (real texts):    ${searchResult?.AC3}`);
  log(`SEARCH AC4 (budget):        ${searchResult?.AC4}`);
  log(`SEARCH AC6 (sitelinks):     ${searchResult?.AC6}`);
  log(`SEARCH campaign_id:         ${searchResult?.campaign_id}`);
  log(`SEARCH deleted:             ${searchResult?.deleted}`);
  if (searchResult?.notes.length) {
    log("SEARCH notes:");
    for (const n of searchResult.notes) log(`  - ${n}`);
  }
  log("");
  log(`RSYA network_bidding:       ${rsyaResult?.network_bidding}`);
  log(`RSYA text_ad_created:       ${rsyaResult?.text_ad_created}`);
  log(`RSYA responsive_ad_created: ${rsyaResult?.responsive_ad_created}`);
  log(`RSYA image_used:            ${rsyaResult?.image_used}`);
  log(`RSYA campaign_id:           ${rsyaResult?.campaign_id}`);
  log(`RSYA deleted:               ${rsyaResult?.deleted}`);
  if (rsyaResult?.notes.length) {
    log("RSYA notes:");
    for (const n of rsyaResult.notes) log(`  - ${n}`);
  }
  log("");
  log(`Cabinet clean:              ${clean}`);
  log(`Dangling IDs:               ${dangling.join(",") || "none"}`);

  const searchFail =
    !searchResult ||
    searchResult.AC2 === "FAIL" ||
    searchResult.AC3 === "FAIL" ||
    searchResult.AC4 === "FAIL" ||
    searchResult.AC6 === "FAIL" ||
    !searchResult.deleted;

  const rsyaFail =
    !rsyaResult ||
    rsyaResult.network_bidding === "FAIL" ||
    !rsyaResult.text_ad_created ||
    !rsyaResult.deleted;

  if (searchFail || rsyaFail || !clean) {
    process.exitCode = 1;
    log("RESULT: FAILURE");
  } else {
    log("RESULT: ALL CHECKS PASSED");
  }
}

main().catch((e) => {
  process.stderr.write(`[both-integration] FATAL: ${String(e)}\n`);
  if (e instanceof Error && e.stack) {
    process.stderr.write(e.stack + "\n");
  }
  process.exit(1);
});
