/**
 * pipeline/cluster.ts — the per-cluster create engine shared by Stage 1 (canary)
 * and Stage 2 (bulk): campaign create/reuse, ad group, keywords, autotargeting,
 * images, and the combinatorial ResponsiveAd.
 *
 * Split out of upload-pipeline.ts (move-only refactor). No behavior change.
 */

import {
  buildUnifiedCampaignPayload,
  buildAdGroupPayload,
  buildKeywordPayload,
  buildResponsiveAdPayload,
  buildAutoTargetingUpdatePayload,
  mapAutotargetingCategoryName,
  sanitizeAutotargetingCategories,
  buildImageUploadPayload,
} from "../payload-builder.js";
import { executeApiCall } from "../api-gateway.js";

import type { ClusterProcessInput, CreateCampaignArgs } from "./types.js";
import {
  computeCampaignName,
  clusterIntent,
  resolveDailyBudgetMicros,
  pickAdTemplatesForCluster,
} from "./plan-hash.js";
import {
  extractId,
  formatDirectApiError,
  extractImageHash,
  fetchImageAsBase64,
  findExistingCampaignId,
} from "./api-utils.js";

/**
 * Call Campaigns.add for a single campaign.
 * Returns the new campaign Id on success, or undefined on error (error is pushed to state).
 */
async function doCreateCampaign(args: CreateCampaignArgs): Promise<number | undefined> {
  const { cluster_id, campaignName, state, ledger, input, account_label, client_login } = args;
  const campaignSig = `campaign:${campaignName}`;
  // ЕПК (UnifiedCampaign): currency-agnostic micros passed through as-is (no RUB math).
  // WB_DAILY_BUDGET is not a valid ЕПК search strategy — map it to HIGHEST_POSITION.
  const searchStrategy =
    input.bidding_strategy_type === "WB_DAILY_BUDGET" ? "HIGHEST_POSITION" : input.bidding_strategy_type;
  // Multi-campaign bundles may override the daily budget per campaign name;
  // fall back to the global budget when this campaign has no override.
  const dailyBudgetMicros =
    input.daily_budget_micros_by_campaign?.[campaignName] ?? resolveDailyBudgetMicros(input);
  const campaignPayload = buildUnifiedCampaignPayload({
    name: campaignName,
    daily_budget_micros: dailyBudgetMicros,
    search_strategy_type: searchStrategy,
    counter_ids: input.metrika_counter_ids,
    goal_ids: input.metrika_goal_ids,
  });

  await ledger.writePending({ op: "campaign", signature: campaignSig, cluster_id });
  state.attempted++;

  const campResult = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v501/campaigns", // ЕПК is v501-only
    body: campaignPayload,
    account: account_label,
    client_login,
  });

  if (!campResult.ok) {
    const errMsg = JSON.stringify(campResult.body);
    await ledger.writeFailed(campaignSig, errMsg);
    state.failed_count++;
    state.errors.push({ cluster_id, step: "campaign_create", error: errMsg });
    const body = campResult.body as { error?: { error_code?: number } };
    if (body?.error?.error_code === 5004) {
      throw new Error("Campaign limit reached (error_code 5004). Stopping pipeline.");
    }
    return undefined;
  }

  let campaign_id: number;
  try {
    campaign_id = extractId(campResult.data);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await ledger.writeFailed(campaignSig, errMsg);
    state.failed_count++;
    state.errors.push({ cluster_id, step: "campaign_create", error: errMsg });
    return undefined;
  }

  await ledger.writeCommitted(campaignSig, campaign_id);
  state.campaigns_created.push(campaign_id);
  state.campaign_id_by_name.set(campaignName, campaign_id);
  return campaign_id;
}

export async function processCluster(opts: ClusterProcessInput): Promise<void> {
  const {
    cluster_id,
    rows,
    state,
    ledger,
    input,
    rsya_image_urls,
    account_label,
    client_login,
  } = opts;

  const intent = clusterIntent(rows);
  const campaignName = computeCampaignName(cluster_id, intent, input.campaign_strategy);

  // Skip empty clusters
  if (rows.length === 0) {
    console.warn(`[SKIP] Cluster ${cluster_id}: 0 keywords`);
    state.errors.push({ cluster_id, step: "keyword_check", error: "0 keywords in cluster" });
    return;
  }

  // Validate keyword lengths
  const validKeywords = rows.filter((r) => {
    if (r.query.length > 4096) {
      state.errors.push({
        cluster_id,
        step: "keyword_check",
        error: `Keyword too long (${r.query.length} chars): ${r.query.slice(0, 80)}`,
      });
      return false;
    }
    return true;
  });

  if (validKeywords.length === 0) {
    state.errors.push({ cluster_id, step: "keyword_check", error: "No valid keywords after length filter" });
    return;
  }

  // ---- Campaign create (or reuse) ----
  let campaign_id: number;

  if (state.campaign_id_by_name.has(campaignName)) {
    campaign_id = state.campaign_id_by_name.get(campaignName)!;
  } else if (input.dedupe_by_name === true) {
    // dedupe_by_name: existing campaigns fetched once before first cluster; reuse if name matches
    const existingId = findExistingCampaignId(state.existing_campaigns, campaignName, state.errors, cluster_id);
    if (existingId !== undefined) {
      console.log(`[DEDUPE] deduped: skip create, reuse Id=${existingId} for "${campaignName}"`); // guardian: allow
      state.campaign_id_by_name.set(campaignName, existingId);
      campaign_id = existingId;
    } else {
      // Name not found in existing — fall through to create
      const created = await doCreateCampaign(
        { cluster_id, campaignName, state, ledger, input, account_label, client_login }
      );
      if (created === undefined) return;
      campaign_id = created;
    }
  } else {
    const created = await doCreateCampaign(
      { cluster_id, campaignName, state, ledger, input, account_label, client_login }
    );
    if (created === undefined) return;
    campaign_id = created;
  }

  // ---- AdGroup create ----
  const markerQuery = rows[0]?.marker_query?.trim() ?? "";
  const adGroupName = (markerQuery.length > 0
    ? markerQuery.slice(0, 255)
    : `adgroup-${cluster_id}`);
  const adGroupSig = `adgroup:${cluster_id}`;
  const adGroupPayload = buildAdGroupPayload({
    campaign_id,
    name: adGroupName,
    region_ids: input.region_ids,
  });

  await ledger.writePending({ op: "ad_group", signature: adGroupSig, cluster_id, parent_id: campaign_id });
  state.attempted++;

  let adGroupResult = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/adgroups",
    body: adGroupPayload,
    account: account_label,
    client_login,
  });

  // Retry once on timeout
  if (!adGroupResult.ok && adGroupResult.status === 504) {
    adGroupResult = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v501/adgroups",
      body: adGroupPayload,
      account: account_label,
      client_login,
    });
  }

  if (!adGroupResult.ok) {
    const errMsg = JSON.stringify(adGroupResult.body);
    await ledger.writeFailed(adGroupSig, errMsg);
    state.failed_count++;
    state.errors.push({ cluster_id, step: "adgroup_create", error: errMsg });
    return;
  }

  let ad_group_id: number;
  try {
    ad_group_id = extractId(adGroupResult.data);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await ledger.writeFailed(adGroupSig, errMsg);
    state.failed_count++;
    state.errors.push({ cluster_id, step: "adgroup_create", error: errMsg });
    return;
  }

  await ledger.writeCommitted(adGroupSig, ad_group_id, campaign_id);
  state.ad_groups_created.push(ad_group_id);

  // ---- Keywords ----
  for (const kw of validKeywords) {
    const kwSig = `keyword:${cluster_id}:${kw.query.slice(0, 80)}`;
    const kwPayload = buildKeywordPayload({ ad_group_id, keyword_text: kw.query });

    await ledger.writePending({ op: "keyword", signature: kwSig, cluster_id, parent_id: ad_group_id });
    state.attempted++;

    const kwResult = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/keywords",
      body: kwPayload,
      account: account_label,
      client_login,
    });

    if (!kwResult.ok) {
      const errMsg = JSON.stringify(kwResult.body);
      await ledger.writeFailed(kwSig, errMsg);
      state.failed_count++;
      state.errors.push({ cluster_id, step: "keyword_add", error: `keyword="${kw.query.slice(0, 40)}": ${errMsg}` });
      // Continue with remaining keywords per error matrix
    } else {
      try {
        const kw_id = extractId(kwResult.data);
        await ledger.writeCommitted(kwSig, kw_id, ad_group_id);
        state.keywords_added++;
      } catch (err) {
        const rawMsg = `id_extraction_failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 600);
        await ledger.writeFailed(kwSig, rawMsg);
        state.failed_count++;
        state.errors.push({ cluster_id, step: "keyword_add", error: rawMsg });
      }
    }
  }

  // ---- Autotargeting update (keyword-based, after keywords are created) ----
  // The ---autotargeting keyword is auto-created by Direct when the ad group is populated.
  // Mechanism: GET keywords to find the ---autotargeting kw Id, then Keywords.update it.
  {
    const explicitCategories = input.autotargeting_per_group?.[cluster_id];
    let rawCategories: Array<{ Category: string; Value: "YES" | "NO" }> | null = null;

    if (explicitCategories !== undefined) {
      rawCategories = explicitCategories;
    } else if (input.campaign_type === "search") {
      // Search default: disable broader/accessory/alternative discovery
      rawCategories = [
        { Category: "BROADER", Value: "NO" },
        { Category: "ACCESSORY", Value: "NO" },
        { Category: "ALTERNATIVE", Value: "NO" },
      ];
    }
    // For RSYA without explicit override: skip autotargeting

    if (rawCategories !== null) {
      // Map legacy names to API names; drop unmappable (TARGET_QUERIES etc.)
      // Then sanitize: drop {EXACT,NO} and guard against all-off (Yandex Code 5005)
      const categories = sanitizeAutotargetingCategories(
        rawCategories
          .map((c) => {
            const apiName = mapAutotargetingCategoryName(c.Category);
            return apiName ? { Category: apiName, Value: c.Value } : null;
          })
          .filter((c): c is { Category: string; Value: "YES" | "NO" } => c !== null),
      );

      // GET keywords for this ad group to find the ---autotargeting keyword
      const kwGetResult = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/keywords",
        body: {
          method: "get",
          params: {
            SelectionCriteria: { AdGroupIds: [ad_group_id] },
            FieldNames: ["Id", "Keyword"],
          },
        },
        account: account_label,
        client_login,
      });

      if (!kwGetResult.ok) {
        const errMsg = JSON.stringify(kwGetResult.body);
        console.warn(`[WARN] autotargeting kw lookup failed for cluster ${cluster_id}: ${errMsg}`); // guardian: allow
        state.errors.push({ cluster_id, step: "autotargeting", error: `kw_lookup: ${errMsg}` });
        // Non-fatal: continue
      } else {
        const kwItems = (kwGetResult.data as { result?: { Keywords?: Array<{ Id: number; Keyword: string }> } })
          ?.result?.Keywords ?? [];
        const atKw = kwItems.find((k) => k.Keyword === "---autotargeting");

        if (!atKw) {
          console.warn(`[WARN] ---autotargeting keyword not found for ad_group ${ad_group_id} (cluster ${cluster_id})`); // guardian: allow
          state.errors.push({ cluster_id, step: "autotargeting", error: "---autotargeting keyword not found" });
          // Non-fatal: continue
        } else {
          const atPayload = buildAutoTargetingUpdatePayload({
            autotargeting_keyword_id: atKw.Id,
            categories,
          });
          const atResult = await executeApiCall({
            apiName: "direct",
            endpoint: "/json/v5/keywords",
            body: atPayload,
            account: account_label,
            client_login,
          });

          if (!atResult.ok) {
            const errMsg = JSON.stringify(atResult.body);
            console.warn(`[WARN] autotargeting update failed for cluster ${cluster_id}: ${errMsg}`); // guardian: allow
            state.errors.push({ cluster_id, step: "autotargeting", error: errMsg });
            // Non-fatal: continue
          } else {
            const updateResults = (atResult.data as { result?: { UpdateResults?: Array<{ Id?: number; Errors?: Array<{ Code: number; Message: string }> }> } })
              ?.result?.UpdateResults;
            const firstUpdateResult = updateResults?.[0];
            if (firstUpdateResult?.Errors && firstUpdateResult.Errors.length > 0) {
              const itemErrMsg = JSON.stringify(firstUpdateResult.Errors);
              console.warn(`[WARN] autotargeting item error for cluster ${cluster_id}: ${itemErrMsg}`); // guardian: allow
              state.errors.push({ cluster_id, step: "autotargeting", error: itemErrMsg });
              // Non-fatal: continue
            }
          }
        }
      }
    }
  }

  // ---- Combinatorial ad (ЕПК RESPONSIVE_AD) ----
  // Exactly ONE combinatorial ad per group: a pool of 1–7 titles × 1–3 texts that
  // Yandex assembles (images optional). Posted to /json/v501/ads. No classic TextAd.
  const sitelinksSetId = input.sitelinks_set_id_per_group?.[cluster_id] ?? input.sitelinks_set_id;
  const calloutIds = input.callout_ids_per_group?.[cluster_id] ?? input.callout_ids;

  // Resolve the title/text pool: combinatorial_per_group is primary; ad_templates is fallback.
  const pool = input.combinatorial_per_group?.[cluster_id];
  const adTemplates = pickAdTemplatesForCluster(
    cluster_id,
    intent,
    input.ad_templates,
    input.ad_template_strategy,
    input.site_url,
  );
  let titles: string[];
  let texts: string[];
  let href: string;
  if (pool && pool.headlines.length > 0 && pool.texts.length > 0) {
    titles = pool.headlines.slice(0, 7);
    texts = pool.texts.slice(0, 3);
    href = adTemplates[0]?.href ?? input.site_url;
  } else if (adTemplates.length > 0) {
    // Derive a pool from templates: distinct titles/title2s and texts.
    const t: string[] = [];
    const x: string[] = [];
    for (const tmpl of adTemplates) {
      if (tmpl.title && !t.includes(tmpl.title)) t.push(tmpl.title);
      if (tmpl.title2 && !t.includes(tmpl.title2)) t.push(tmpl.title2);
      if (tmpl.text && !x.includes(tmpl.text)) x.push(tmpl.text);
    }
    titles = t.slice(0, 7);
    texts = x.slice(0, 3);
    href = adTemplates[0]?.href ?? input.site_url;
  } else {
    state.errors.push({ cluster_id, step: "ad_create", error: "no combinatorial pool or ad templates for cluster" });
    return;
  }
  if (titles.length === 0 || texts.length === 0) {
    state.errors.push({ cluster_id, step: "ad_create", error: "empty titles or texts pool" });
    return;
  }

  // Collect image hashes if available (optional — text-only combinatorial ads are valid).
  const collectedHashes: string[] = [];
  const perGroupImages = input.image_hashes_per_group?.[cluster_id];
  const hasImageHashes = input.image_hashes && Object.keys(input.image_hashes).length > 0;
  if (perGroupImages && perGroupImages.length > 0) {
    // Per-group images (this group's own ${img_key} refs) take precedence.
    for (const h of perGroupImages) {
      if (h && !collectedHashes.includes(h)) collectedHashes.push(h);
      if (collectedHashes.length >= 5) break;
    }
    for (const h of collectedHashes) {
      if (!state.images_uploaded.includes(h)) state.images_uploaded.push(h);
    }
  } else if (hasImageHashes) {
    for (const h of Object.values(input.image_hashes!)) {
      if (h && !collectedHashes.includes(h)) collectedHashes.push(h);
      if (collectedHashes.length >= 5) break;
    }
    for (const h of collectedHashes) {
      if (!state.images_uploaded.includes(h)) state.images_uploaded.push(h);
    }
  } else if (rsya_image_urls.length > 0) {
    for (const imageUrl of rsya_image_urls) {
      if (collectedHashes.length >= 5) break;
      const cachedHash = state.image_hash_by_url.get(imageUrl);
      if (cachedHash) {
        if (!collectedHashes.includes(cachedHash)) collectedHashes.push(cachedHash);
        continue;
      }
      try {
        const { base64, format } = await fetchImageAsBase64(imageUrl);
        const imgSig = `image:${imageUrl.slice(0, 80)}`;
        const imgPayload = buildImageUploadPayload({ base64, format });
        await ledger.writePending({ op: "image", signature: imgSig, cluster_id });
        state.attempted++;
        const imgResult = await executeApiCall({
          apiName: "direct",
          endpoint: "/json/v5/adimages",
          body: imgPayload,
          account: account_label,
          client_login,
        });
        if (!imgResult.ok) {
          const errMsg = JSON.stringify(imgResult.body);
          await ledger.writeFailed(imgSig, errMsg);
          state.failed_count++;
          state.errors.push({ cluster_id, step: "image_upload", error: `url=${imageUrl.slice(0, 60)}: ${errMsg}` });
        } else {
          const imgAddResult = (imgResult.data as { result?: { AddResults?: Array<{ AdImageHash?: string; Errors?: Array<{ Code: number; Message: string }> }> } })
            ?.result?.AddResults?.[0];
          if (imgAddResult?.Errors && imgAddResult.Errors.length > 0) {
            const itemErrMsg = JSON.stringify(imgAddResult.Errors);
            await ledger.writeFailed(imgSig, itemErrMsg);
            state.errors.push({ cluster_id, step: "image_upload", error: `url=${imageUrl.slice(0, 60)} rejected: ${itemErrMsg}` });
          } else {
            const uploadedHash = extractImageHash(imgResult.data);
            await ledger.writeCommitted(imgSig, uploadedHash);
            state.image_hash_by_url.set(imageUrl, uploadedHash);
            state.images_uploaded.push(uploadedHash);
            if (!collectedHashes.includes(uploadedHash)) collectedHashes.push(uploadedHash);
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        state.errors.push({ cluster_id, step: "image_upload", error: errMsg });
      }
    }
  }

  // Build & create the single combinatorial ResponsiveAd for this group.
  const adSig = `ad_combinatorial:${cluster_id}`;
  const adPayload = buildResponsiveAdPayload({
    ad_group_id,
    Titles: titles,
    Texts: texts,
    Href: href,
    AdImageHashes: collectedHashes.length > 0 ? collectedHashes : undefined,
    SitelinkSetId: sitelinksSetId,
    AdExtensionIds: calloutIds,
  });
  await ledger.writePending({ op: "ad_combinatorial", signature: adSig, cluster_id, parent_id: ad_group_id });
  state.attempted++;
  const adResult = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v501/ads", // combinatorial RESPONSIVE_AD is v501-only
    body: adPayload,
    account: account_label,
    client_login,
  });
  if (!adResult.ok) {
    const errMsg = JSON.stringify(adResult.body);
    await ledger.writeFailed(adSig, errMsg);
    state.failed_count++;
    state.errors.push({ cluster_id, step: "ad_create", error: errMsg });
  } else {
    const apiErr = formatDirectApiError(adResult.data);
    if (apiErr) {
      await ledger.writeFailed(adSig, apiErr);
      state.failed_count++;
      state.errors.push({ cluster_id, step: "ad_create", error: apiErr });
    } else {
      const addResults = (adResult.data as { result?: { AddResults?: Array<{ Id?: number | string; Errors?: Array<{ Code: number; Message: string }> }> } })
        ?.result?.AddResults;
      const firstResult = addResults?.[0];
      if (firstResult?.Id !== undefined && firstResult?.Id !== null) {
        // Ad Ids exceed 2^53 — keep the exact string, never a rounded number.
        const ad_id = String(firstResult.Id);
        await ledger.writeCommitted(adSig, ad_id, ad_group_id);
        state.ads_created.push(ad_id);
      } else if (firstResult?.Errors && firstResult.Errors.length > 0) {
        const itemErrMsg = JSON.stringify(firstResult.Errors);
        await ledger.writeFailed(adSig, itemErrMsg);
        state.failed_count++;
        state.errors.push({ cluster_id, step: "ad_create", error: itemErrMsg });
      } else {
        const rawMsg = `id_extraction_failed: ${JSON.stringify(adResult.data)?.slice(0, 600)}`;
        await ledger.writeFailed(adSig, rawMsg);
        state.failed_count++;
        state.errors.push({ cluster_id, step: "ad_create", error: rawMsg });
      }
    }
  }
}
