/**
 * pipeline/orchestrator.ts — CSV → Direct bundle upload orchestrator.
 *
 * Three stages:
 *   Stage 0 (dry_run=true or undefined): plan generation, returns PLAN_HASH + expected_ack_live.
 *   Stage 1 (dry_run=false, plan_hash set, canary_passed undefined): gate + canary run.
 *   Stage 2 (dry_run=false, plan_hash set, canary_passed=true, continuation_ack set): bulk continuation.
 *
 * No Ads.moderate calls — all ads remain DRAFT. User reviews in Direct UI.
 *
 * Split out of upload-pipeline.ts (move-only refactor). No behavior change.
 */

import * as fs from "fs";
import * as path from "path";

import { parseKeyCollectorCsv, type ClusterRow } from "../csv-parser.js";
import { openLedger } from "../bundle-ledger.js";
import { buildMetrikaUpdatePayload } from "../payload-builder.js";
import { executeApiCall } from "../api-gateway.js";
import { requireConfirmGate } from "../api/confirm-gate.js";
import { resolveAccount } from "../account-resolver.js";
import { SCOPES } from "../scopes.js";

import type {
  ProcessState,
  UploadCampaignBundleInput,
  UploadCampaignBundleOutput,
} from "./types.js";
import {
  computeCampaignName,
  clusterIntent,
  computePlanHash,
  resolveDailyBudgetMicros,
} from "./plan-hash.js";
import { ensureDir, ledgerOp, fetchExistingCampaigns } from "./api-utils.js";
import { processCluster } from "./cluster.js";

// ---------------------------------------------------------------------------
// Stage 0 — dry-run plan
// ---------------------------------------------------------------------------

async function stage0DryRun(
  input: UploadCampaignBundleInput,
  clusters: Map<string, ClusterRow[]>,
  csvSha256: string,
  totalClusters: number
): Promise<UploadCampaignBundleOutput> {
  const maxClusters = input.max_clusters ?? 50;
  const canaryPercent = input.canary_percent ?? 10;
  const adsPerGroup = input.ads_per_group ?? 3;
  const rsyaImageUrls = input.rsya_image_urls ?? [];

  // Apply intent filter if one-per-intent strategy
  let filteredEntries = [...clusters.entries()];
  if (input.campaign_strategy.mode === "one-per-intent" && input.campaign_strategy.intent_to_campaign) {
    const allowedIntents = Object.keys(input.campaign_strategy.intent_to_campaign);
    filteredEntries = filteredEntries.filter(([, rows]) =>
      allowedIntents.includes(clusterIntent(rows))
    );
  }
  // Apply max_clusters cap
  filteredEntries = filteredEntries.slice(0, maxClusters);

  const acc = resolveAccount(SCOPES.DIRECT_API, input.account);
  const yandexLogin = acc.yandex_login ?? acc.label;

  // Compute planned campaign names (deduplicated)
  const plannedNamesSet = new Set<string>();
  for (const [cluster_id, rows] of filteredEntries) {
    plannedNamesSet.add(computeCampaignName(cluster_id, clusterIntent(rows), input.campaign_strategy));
  }
  const plannedNames = [...plannedNamesSet].sort();

  const planHash = computePlanHash({
    csv_hash: csvSha256,
    account_login: yandexLogin,
    campaign_strategy: input.campaign_strategy,
    campaign_type: input.campaign_type,
    site_url: input.site_url,
    daily_budget_micros: resolveDailyBudgetMicros(input),
    region_ids: input.region_ids,
    bidding_strategy_type: input.bidding_strategy_type,
    metrika_counter_ids: input.metrika_counter_ids,
    metrika_goal_ids: input.metrika_goal_ids,
    rsya_image_urls: rsyaImageUrls,
    ads_per_group: adsPerGroup,
    canary_percent: canaryPercent,
    max_clusters: maxClusters,
    cluster_count: filteredEntries.length,
    campaign_names: plannedNames,
    ad_templates: input.ad_templates ?? null,
    bidding_strategy: input.bidding_strategy ?? null,
    sitelinks_set: input.sitelinks_set ?? null,
    promo_extension: input.promo_extension ?? null,
    callouts: input.callouts ?? null,
    image_hashes_keys: input.declared_image_keys !== undefined
      ? (input.declared_image_keys ?? null)
      : (input.image_hashes ? Object.keys(input.image_hashes) : null),
    dedupe_by_name: input.dedupe_by_name ?? false,
    sitelinks_set_per_group: input.sitelinks_set_per_group ?? null,
    callouts_per_group: input.callouts_per_group ?? null,
    daily_budget_micros_by_campaign: input.daily_budget_micros_by_campaign ?? null,
  });

  const expectedAckLive = `I-UNDERSTAND-BUNDLE-LIVE:${input.client_login ?? yandexLogin}:${planHash.slice(0, 12)}`;

  console.log("\n=== UPLOAD PLAN (dry_run=true) ==="); // guardian: allow
  console.log(`Account:         ${yandexLogin}${input.client_login ? ` -> Client-Login: ${input.client_login}` : ""}`); // guardian: allow
  console.log(`CSV clusters:    ${totalClusters} total, ${filteredEntries.length} after caps`); // guardian: allow
  console.log(`Campaign type:   ${input.campaign_type}`); // guardian: allow
  console.log(`Strategy:        ${input.campaign_strategy.mode}`); // guardian: allow
  console.log(`Planned campaigns: ${plannedNames.join(", ")}`); // guardian: allow
  console.log(`Canary percent:  ${canaryPercent}% (${Math.max(1, Math.ceil(filteredEntries.length * canaryPercent / 100))} clusters)`); // guardian: allow
  console.log(`PLAN_HASH:       ${planHash}`); // guardian: allow
  console.log(`\nTo run live:`); // guardian: allow
  console.log(`  dry_run: false`); // guardian: allow
  console.log(`  confirm: true`); // guardian: allow
  console.log(`  acknowledge_live: "${expectedAckLive}"`); // guardian: allow
  console.log(`  plan_hash: "${planHash}"`); // guardian: allow
  console.log("===================================\n"); // guardian: allow

  return {
    dry_run: true,
    total_clusters: totalClusters,
    clusters_processed: 0,
    campaigns_created: [],
    ad_groups_created: [],
    keywords_added: 0,
    ads_created: [],
    images_uploaded: [],
    metrika_linked: false,
    canary_passed: false,
    ledger_path: "",
    errors: [],
    plan_hash: planHash,
    expected_ack_live: expectedAckLive,
    recovery_command: "",
    next_actions: [
      `Re-call with dry_run=false, confirm=true, acknowledge_live="${expectedAckLive}", plan_hash="${planHash}"`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Stage 1 — gate + canary
// ---------------------------------------------------------------------------

async function stage1Canary(
  input: UploadCampaignBundleInput,
  filteredEntries: [string, ClusterRow[]][],
  totalClusters: number,
  planHash: string,
  expectedAckLive: string,
  acc: { label: string; id: number; yandex_login: string | null }
): Promise<UploadCampaignBundleOutput> {
  const canaryPercent = input.canary_percent ?? 10;
  const abortOnErrorRate = input.abort_on_error_rate ?? 0.3;

  // Validate plan_hash binding
  if (!input.plan_hash) {
    throw new Error("plan_hash is required for live execution. Re-run with dry_run=true to get plan_hash.");
  }
  if (input.plan_hash !== planHash) {
    throw new Error(
      `plan_hash mismatch — inputs changed since dry-run. ` +
      `Expected: ${planHash}. Got: ${input.plan_hash}. Re-run dry_run=true to get a fresh plan_hash.`
    );
  }

  // Confirm gate
  requireConfirmGate(
    { confirm: input.confirm, acknowledge_live: input.acknowledge_live },
    { expectedAck: expectedAckLive }
  );

  // Open ledger
  const yandexLogin = acc.yandex_login ?? acc.label;
  const ts = Date.now();
  const ledgerDir = path.resolve(
    path.join(process.cwd(), "packages/yandex-seo/data")
  );
  ensureDir(ledgerDir);
  const ledgerPath = path.join(ledgerDir, `bundle-ledger-${planHash.slice(0, 12)}-${ts}.jsonl`);
  const ledger = await openLedger(ledgerPath);

  // Pre-fetch existing campaigns once if dedupe_by_name is enabled
  const existingCampaigns = input.dedupe_by_name === true
    ? await fetchExistingCampaigns(input.account, input.client_login)
    : [];

  const state: ProcessState = {
    campaigns_created: [],
    ad_groups_created: [],
    keywords_added: 0,
    ads_created: [],
    images_uploaded: [],
    errors: [],
    attempted: 0,
    failed_count: 0,
    campaign_id_by_name: new Map(),
    image_hash_by_url: new Map(),
    existing_campaigns: existingCampaigns,
  };

  const rsyaImageUrls = input.rsya_image_urls ?? [];
  const canaryCount = Math.max(1, Math.ceil(filteredEntries.length * canaryPercent / 100));
  const canarySlice = filteredEntries.slice(0, canaryCount);

  try {
    for (const [cluster_id, rows] of canarySlice) {
      try {
        await processCluster({
          cluster_id,
          rows,
          state,
          ledger,
          input,
          rsya_image_urls: rsyaImageUrls,
          account_label: input.account,
          client_login: input.client_login,
        });
      } catch (err) {
        // Campaign limit or hard stop
        const errMsg = err instanceof Error ? err.message : String(err);
        state.errors.push({ cluster_id, step: "cluster_loop", error: errMsg });
        break;
      }
    }
  } finally {
    await ledger.close();
  }

  // Error rate check
  const errorRate = state.attempted > 0 ? state.failed_count / state.attempted : 0;

  if (errorRate >= abortOnErrorRate) {
    return {
      dry_run: false,
      total_clusters: totalClusters,
      clusters_processed: canaryCount,
      campaigns_created: state.campaigns_created,
      ad_groups_created: state.ad_groups_created,
      keywords_added: state.keywords_added,
      ads_created: state.ads_created,
      images_uploaded: state.images_uploaded,
      metrika_linked: false,
      canary_passed: false,
      ledger_path: ledgerPath,
      errors: state.errors,
      stage: "canary_aborted",
      recovery_command: `npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"`,
      next_actions: [
        `Canary error rate ${(errorRate * 100).toFixed(1)}% >= threshold ${(abortOnErrorRate * 100).toFixed(1)}%. Review errors above.`,
        `To clean up: npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"`,
      ],
    };
  }

  // Count committed ledger entries — must match what stage2Continuation will read from the same ledger.
  // Read from ledger directly (not from in-memory state) so that pre-uploaded images passed via
  // image_hashes (which are not written to the ledger) are excluded from the count.
  const allLedgerEntries = await ledger.readAll();
  const committedCount = allLedgerEntries.filter((e) => e.state === "committed").length;
  const expectedContinuationAck = `I-UNDERSTAND-CONTINUE-LIVE:${input.client_login ?? yandexLogin}:${planHash.slice(0, 12)}:${committedCount}`;

  console.log("\n=== CANARY PASSED ==="); // guardian: allow
  console.log(`Clusters processed: ${canaryCount} / ${filteredEntries.length}`); // guardian: allow
  console.log(`Campaigns created:  ${state.campaigns_created.join(", ") || "(none)"}`); // guardian: allow
  console.log(`Error rate:         ${(errorRate * 100).toFixed(1)}%`); // guardian: allow
  console.log(`Ledger:             ${ledgerPath}`); // guardian: allow
  console.log(`\nTo continue:`); // guardian: allow
  console.log(`  canary_passed: true`); // guardian: allow
  console.log(`  continuation_ack: "${expectedContinuationAck}"`); // guardian: allow
  console.log("====================\n"); // guardian: allow

  return {
    dry_run: false,
    total_clusters: totalClusters,
    clusters_processed: canaryCount,
    campaigns_created: state.campaigns_created,
    ad_groups_created: state.ad_groups_created,
    keywords_added: state.keywords_added,
    ads_created: state.ads_created,
    images_uploaded: state.images_uploaded,
    metrika_linked: false,
    canary_passed: true,
    ledger_path: ledgerPath,
    errors: state.errors,
    stage: "canary_passed",
    expected_continuation_ack: expectedContinuationAck,
    recovery_command: `npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"`,
    next_actions: [
      `Canary passed (${canaryCount} clusters, ${state.campaigns_created.length} campaigns created).`,
      `Check campaigns in Direct UI, then re-call with canary_passed=true, continuation_ack="${expectedContinuationAck}"`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — bulk continuation
// ---------------------------------------------------------------------------

async function stage2Continuation(
  input: UploadCampaignBundleInput,
  filteredEntries: [string, ClusterRow[]][],
  totalClusters: number,
  planHash: string,
  acc: { label: string; id: number; yandex_login: string | null }
): Promise<UploadCampaignBundleOutput> {
  const canaryPercent = input.canary_percent ?? 10;
  const canaryCount = Math.max(1, Math.ceil(filteredEntries.length * canaryPercent / 100));
  const yandexLogin = acc.yandex_login ?? acc.label;

  // Find the canary ledger — look for matching plan_hash prefix file
  const dataDir = path.resolve(path.join(process.cwd(), "packages/yandex-seo/data"));
  const prefix = `bundle-ledger-${planHash.slice(0, 12)}-`;
  let ledgerPath: string;

  if (fs.existsSync(dataDir)) {
    const existing = fs.readdirSync(dataDir)
      .filter((f) => f.startsWith(prefix))
      .sort()
      .reverse(); // most recent first
    if (existing.length > 0) {
      ledgerPath = path.join(dataDir, existing[0]);
    } else {
      ledgerPath = path.join(dataDir, `bundle-ledger-${planHash.slice(0, 12)}-${Date.now()}.jsonl`);
    }
  } else {
    ensureDir(dataDir);
    ledgerPath = path.join(dataDir, `bundle-ledger-${planHash.slice(0, 12)}-${Date.now()}.jsonl`);
  }

  const ledger = await openLedger(ledgerPath);

  // Read committed entries from canary to rebuild state
  const priorEntries = await ledger.readAll();
  const committedPrior = priorEntries.filter((e) => e.state === "committed");
  const priorCommittedCount = committedPrior.length;

  // Validate continuation_ack
  const expectedContinuationAck = `I-UNDERSTAND-CONTINUE-LIVE:${input.client_login ?? yandexLogin}:${planHash.slice(0, 12)}:${priorCommittedCount}`;
  if (input.continuation_ack !== expectedContinuationAck) {
    await ledger.close();
    throw new Error(
      `continuation_ack mismatch. Expected: "${expectedContinuationAck}". ` +
      `Got: "${input.continuation_ack}". The committed count (${priorCommittedCount}) must match canary results.`
    );
  }

  // Pre-fetch existing campaigns once if dedupe_by_name is enabled
  const existingCampaignsStage2 = input.dedupe_by_name === true
    ? await fetchExistingCampaigns(input.account, input.client_login)
    : [];

  // Restore state from prior ledger entries
  const state: ProcessState = {
    campaigns_created: [],
    ad_groups_created: [],
    keywords_added: 0,
    ads_created: [],
    images_uploaded: [],
    errors: [],
    attempted: 0,
    failed_count: 0,
    campaign_id_by_name: new Map(),
    image_hash_by_url: new Map(),
    existing_campaigns: existingCampaignsStage2,
  };

  // Rebuild state from prior ledger entries. Committed rows historically store op=""
  // and encode the operation in signature, so fall back to signature prefix.
  for (const entry of committedPrior) {
    const op = ledgerOp(entry);
    if (op === "campaign" && typeof entry.returned_id === "number") {
      const sig = entry.signature; // "campaign:<name>"
      const nameFromSig = sig.replace(/^campaign:/, "");
      state.campaign_id_by_name.set(nameFromSig, entry.returned_id);
      state.campaigns_created.push(entry.returned_id);
    } else if ((op === "ad_group" || op === "adgroup") && typeof entry.returned_id === "number") {
      state.ad_groups_created.push(entry.returned_id);
    } else if (op === "keyword") {
      state.keywords_added++;
    } else if (
      (op === "ad_tgo" || op === "ad_rsya" || op === "ad_rsya_comb" || op === "ad_combinatorial") &&
      (typeof entry.returned_id === "number" || typeof entry.returned_id === "string")
    ) {
      state.ads_created.push(entry.returned_id);
    } else if (op === "image" && typeof entry.returned_id === "string") {
      state.images_uploaded.push(entry.returned_id);
    }
  }

  const rsyaImageUrls = input.rsya_image_urls ?? [];
  const bulkSlice = filteredEntries.slice(canaryCount);

  try {
    for (const [cluster_id, rows] of bulkSlice) {
      try {
        await processCluster({
          cluster_id,
          rows,
          state,
          ledger,
          input,
          rsya_image_urls: rsyaImageUrls,
          account_label: input.account,
          client_login: input.client_login,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        state.errors.push({ cluster_id, step: "cluster_loop", error: errMsg });
        break;
      }
    }

    // Stage 2 error rate check — mirrors Stage 1 canary abort logic
    const abortOnErrorRate = input.abort_on_error_rate ?? 0.3;
    const bulkErrorRate = state.attempted > 0 ? state.failed_count / state.attempted : 0;
    if (bulkErrorRate >= abortOnErrorRate) {
      return {
        dry_run: false,
        total_clusters: totalClusters,
        clusters_processed: canaryCount + bulkSlice.length,
        campaigns_created: state.campaigns_created,
        ad_groups_created: state.ad_groups_created,
        keywords_added: state.keywords_added,
        ads_created: state.ads_created,
        images_uploaded: state.images_uploaded,
        metrika_linked: false,
        canary_passed: true,
        ledger_path: ledgerPath,
        errors: state.errors,
        stage: "bulk_aborted",
        recovery_command: `npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"`,
        next_actions: [
          `Bulk error rate ${(bulkErrorRate * 100).toFixed(1)}% >= threshold ${(abortOnErrorRate * 100).toFixed(1)}%. Campaign bundle is INCOMPLETE.`,
          `Review errors above, then run recovery: npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"`,
        ],
      };
    }

    // Metrika linking
    let metrikaLinked = false;
    if (input.metrika_counter_ids && input.metrika_goal_ids && input.metrika_counter_ids.length > 0 && input.metrika_goal_ids.length > 0) {
      const strategyType = input.bidding_strategy_type === "WB_DAILY_BUDGET"
        ? "WB_DAILY_BUDGET"
        : input.bidding_strategy_type === "AVERAGE_CPC"
        ? "WB_DAILY_BUDGET"  // fallback to WB for metrika linking
        : "WB_DAILY_BUDGET";

      for (const campaign_id of state.campaigns_created) {
        try {
          const metrikaPayload = buildMetrikaUpdatePayload({
            campaign_id,
            counter_ids: input.metrika_counter_ids,
            goal_ids: input.metrika_goal_ids,
            strategy_type: strategyType,
          });
          const metrikaResult = await executeApiCall({
            apiName: "direct",
            endpoint: "/json/v5/campaigns",
            method: "POST",
            body: metrikaPayload,
            account: input.account,
            client_login: input.client_login,
          });
          if (!metrikaResult.ok) {
            const errMsg = JSON.stringify(metrikaResult.body);
            state.errors.push({ cluster_id: `campaign:${campaign_id}`, step: "metrika_link", error: errMsg });
          } else {
            metrikaLinked = true;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          state.errors.push({ cluster_id: `campaign:${campaign_id}`, step: "metrika_link", error: errMsg });
          // Continue per error matrix — drafts created without goals
        }
      }
    }

    // Generate report
    const runsDir = path.resolve(
      path.join(process.cwd(), "docs/plans/phase-3-5-c-csv-upload-pipeline/runs")
    );
    ensureDir(runsDir);
    const reportTs = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = path.join(runsDir, `${planHash.slice(0, 12)}-${reportTs}.md`);
    const reportContent = [
      `# Upload Report`,
      ``,
      `- **Plan hash:** ${planHash}`,
      `- **Account:** ${yandexLogin}`,
      `- **Timestamp:** ${new Date().toISOString()}`,
      `- **Total clusters:** ${totalClusters}`,
      `- **Clusters processed:** ${canaryCount + bulkSlice.length}`,
      `- **Campaigns created:** ${state.campaigns_created.length} (IDs: ${state.campaigns_created.join(", ")})`,
      `- **Ad groups created:** ${state.ad_groups_created.length}`,
      `- **Keywords added:** ${state.keywords_added}`,
      `- **Ads created:** ${state.ads_created.length}`,
      `- **Images uploaded:** ${state.images_uploaded.join(", ") || "none"}`,
      `- **Metrika linked:** ${metrikaLinked}`,
      `- **Errors:** ${state.errors.length}`,
      ``,
      `## Error Details`,
      ``,
      state.errors.length === 0
        ? "_No errors._"
        : state.errors.map((e) => `- **${e.step}** (cluster ${e.cluster_id}): ${e.error}`).join("\n"),
      ``,
      `## Ledger`,
      ``,
      `\`${ledgerPath}\``,
      ``,
      `## Recovery`,
      ``,
      `\`npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"\``,
    ].join("\n");

    fs.writeFileSync(reportPath, reportContent, "utf-8");
    console.log(`\nReport written: ${reportPath}`); // guardian: allow

    return {
      dry_run: false,
      total_clusters: totalClusters,
      clusters_processed: canaryCount + bulkSlice.length,
      campaigns_created: state.campaigns_created,
      ad_groups_created: state.ad_groups_created,
      keywords_added: state.keywords_added,
      ads_created: state.ads_created,
      images_uploaded: state.images_uploaded,
      metrika_linked: metrikaLinked,
      canary_passed: true,
      ledger_path: ledgerPath,
      errors: state.errors,
      stage: "completed",
      recovery_command: `npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"`,
      next_actions: [
        `Bundle upload complete. Review campaigns in Yandex Direct UI.`,
        `All ads are in DRAFT state — review and send for moderation manually.`,
        ...(metrikaLinked ? [] : [`Metrika linking failed or not configured — link goals manually.`]),
      ],
    };
  } finally {
    await ledger.close();
  }
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function uploadCampaignBundle(
  input: UploadCampaignBundleInput
): Promise<UploadCampaignBundleOutput> {
  // Parse CSV
  const csv = parseKeyCollectorCsv(input.csv_path);
  const { clusters, sha256: csvSha256, total_clusters: totalClusters } = csv;

  const maxClusters = input.max_clusters ?? 50;
  const canaryPercent = input.canary_percent ?? 10;
  const adsPerGroup = input.ads_per_group ?? 3;
  const rsyaImageUrls = input.rsya_image_urls ?? [];

  // Apply intent filter if one-per-intent strategy
  let filteredEntries = [...clusters.entries()];
  if (
    input.campaign_strategy.mode === "one-per-intent" &&
    input.campaign_strategy.intent_to_campaign
  ) {
    const allowedIntents = Object.keys(input.campaign_strategy.intent_to_campaign);
    filteredEntries = filteredEntries.filter(([, rows]) =>
      allowedIntents.includes(clusterIntent(rows))
    );
  }
  // Apply max_clusters cap
  filteredEntries = filteredEntries.slice(0, maxClusters);

  // Resolve account
  const acc = resolveAccount(SCOPES.DIRECT_API, input.account);
  const yandexLogin = acc.yandex_login ?? acc.label;

  // Compute planned campaign names
  const plannedNamesSet = new Set<string>();
  for (const [cluster_id, rows] of filteredEntries) {
    plannedNamesSet.add(
      computeCampaignName(cluster_id, clusterIntent(rows), input.campaign_strategy)
    );
  }
  const plannedNames = [...plannedNamesSet];

  // Compute PLAN_HASH
  const planHash = computePlanHash({
    csv_hash: csvSha256,
    account_login: yandexLogin,
    campaign_strategy: input.campaign_strategy,
    campaign_type: input.campaign_type,
    site_url: input.site_url,
    daily_budget_micros: resolveDailyBudgetMicros(input),
    region_ids: input.region_ids,
    bidding_strategy_type: input.bidding_strategy_type,
    metrika_counter_ids: input.metrika_counter_ids,
    metrika_goal_ids: input.metrika_goal_ids,
    rsya_image_urls: rsyaImageUrls,
    ads_per_group: adsPerGroup,
    canary_percent: canaryPercent,
    max_clusters: maxClusters,
    cluster_count: filteredEntries.length,
    campaign_names: plannedNames,
    ad_templates: input.ad_templates ?? null,
    bidding_strategy: input.bidding_strategy ?? null,
    sitelinks_set: input.sitelinks_set ?? null,
    promo_extension: input.promo_extension ?? null,
    callouts: input.callouts ?? null,
    image_hashes_keys: input.declared_image_keys !== undefined
      ? (input.declared_image_keys ?? null)
      : (input.image_hashes ? Object.keys(input.image_hashes) : null),
    dedupe_by_name: input.dedupe_by_name ?? false,
    sitelinks_set_per_group: input.sitelinks_set_per_group ?? null,
    callouts_per_group: input.callouts_per_group ?? null,
    daily_budget_micros_by_campaign: input.daily_budget_micros_by_campaign ?? null,
  });

  const expectedAckLive = `I-UNDERSTAND-BUNDLE-LIVE:${input.client_login ?? yandexLogin}:${planHash.slice(0, 12)}`;

  // Stage detection
  const isDryRun = input.dry_run !== false; // default true
  const isContinuation =
    input.dry_run === false && input.plan_hash !== undefined && input.canary_passed === true;

  if (isDryRun) {
    return stage0DryRun(input, clusters, csvSha256, totalClusters);
  }

  if (isContinuation) {
    return stage2Continuation(input, filteredEntries, totalClusters, planHash, acc);
  }

  // Stage 1 — canary
  return stage1Canary(input, filteredEntries, totalClusters, planHash, expectedAckLive, acc);
}
