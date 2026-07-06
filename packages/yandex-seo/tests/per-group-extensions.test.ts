/**
 * per-group-extensions.test.ts — per-group sitelinks/callouts support in the pipeline.
 *
 * Covers:
 *   - computePlanHash binds per-group sitelinks/callouts CONTENT: editing a group's
 *     sitelinks or callouts changes the hash; record key order does not.
 *   - processCluster (via uploadCampaignBundle live run) wires per-group
 *     sitelinks_set_id / callout_ids into ad payloads, with fallback to
 *     campaign-level ids for groups without an override.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock transitive dependencies that import @ohmy-seo/mcp-core subpaths
vi.mock("../src/lib/api-gateway.js", () => ({
  executeApiCall: vi.fn(),
}));
vi.mock("../src/lib/account-resolver.js", () => ({
  resolveAccount: vi.fn(),
}));
vi.mock("../src/lib/csv-parser.js", () => ({
  parseKeyCollectorCsv: vi.fn(),
}));
vi.mock("../src/lib/bundle-ledger.js", () => ({
  openLedger: vi.fn(),
}));
vi.mock("../src/lib/payload-builder.js", () => ({
  buildUnifiedCampaignPayload: vi.fn().mockReturnValue({ method: "add", params: { Campaigns: [{}] } }),
  buildAdGroupPayload: vi.fn(),
  buildKeywordPayload: vi.fn(),
  buildImageUploadPayload: vi.fn(),
  buildMetrikaUpdatePayload: vi.fn(),
  buildAutoTargetingUpdatePayload: vi.fn().mockReturnValue({ method: "update", params: { Keywords: [{}] } }),
  mapAutotargetingCategoryName: vi.fn().mockImplementation((name: string) => name),
  sanitizeAutotargetingCategories: vi.fn().mockImplementation((cats: Array<{ Category: string; Value: "YES" | "NO" }>) => cats),
  buildResponsiveAdPayload: vi.fn(),
}));
vi.mock("../src/lib/api/confirm-gate.js", () => ({
  requireConfirmGate: vi.fn(),
}));
vi.mock("../src/lib/scopes.js", () => ({
  SCOPES: { DIRECT_API: "direct" },
}));

import { computePlanHash, uploadCampaignBundle } from "../src/lib/upload-pipeline.js";
import { executeApiCall, type ExecuteOpts } from "../src/lib/api-gateway.js";
import { resolveAccount } from "../src/lib/account-resolver.js";
import { parseKeyCollectorCsv } from "../src/lib/csv-parser.js";
import { openLedger } from "../src/lib/bundle-ledger.js";
import {
  buildAdGroupPayload,
  buildKeywordPayload,
  buildResponsiveAdPayload,
} from "../src/lib/payload-builder.js";

// ---------------------------------------------------------------------------
// computePlanHash — per-group content binding
// ---------------------------------------------------------------------------

const SET_A = {
  Sitelinks: [
    { Title: "Каталог", Description: "Весь каталог", Href: "https://example.com/catalog" },
    { Title: "Доставка", Description: "По всей РФ", Href: "https://example.com/delivery" },
  ],
};

function baseHashInput() {
  return {
    csv_hash: "deadbeef1234",
    account_login: "test-login",
    campaign_strategy: { mode: "one-per-cluster" as const },
    campaign_type: "search",
    site_url: "https://example.com",
    daily_budget_micros: 300_000_000,
    region_ids: [213],
    bidding_strategy_type: "WB_DAILY_BUDGET",
    rsya_image_urls: [],
    ads_per_group: 1,
    canary_percent: 100,
    max_clusters: 2,
    cluster_count: 2,
    campaign_names: ["cluster-cl01", "cluster-cl02"],
  };
}

describe("computePlanHash — per-group sitelinks/callouts content", () => {
  it("is deterministic for identical inputs", () => {
    const a = computePlanHash({ ...baseHashInput(), sitelinks_set_per_group: { cl01: SET_A } });
    const b = computePlanHash({ ...baseHashInput(), sitelinks_set_per_group: { cl01: SET_A } });
    expect(a).toBe(b);
  });

  it("changes when a per-group sitelinks set is added", () => {
    const without = computePlanHash(baseHashInput());
    const withSet = computePlanHash({ ...baseHashInput(), sitelinks_set_per_group: { cl01: SET_A } });
    expect(withSet).not.toBe(without);
  });

  it("changes when a group's sitelink content is edited (Title)", () => {
    const original = computePlanHash({ ...baseHashInput(), sitelinks_set_per_group: { cl01: SET_A } });
    const edited = computePlanHash({
      ...baseHashInput(),
      sitelinks_set_per_group: {
        cl01: {
          Sitelinks: [
            { ...SET_A.Sitelinks[0], Title: "Каталог 2026" },
            SET_A.Sitelinks[1],
          ],
        },
      },
    });
    expect(edited).not.toBe(original);
  });

  it("changes when per-group callouts change", () => {
    const a = computePlanHash({ ...baseHashInput(), callouts_per_group: { cl01: ["Гарантия", "Доставка"] } });
    const b = computePlanHash({ ...baseHashInput(), callouts_per_group: { cl01: ["Гарантия", "Монтаж"] } });
    expect(a).not.toBe(b);
  });

  it("is independent of record key insertion order (stableStringify)", () => {
    const SET_B = { Sitelinks: [{ Title: "Цены", Href: "https://example.com/prices" }] };
    const a = computePlanHash({ ...baseHashInput(), sitelinks_set_per_group: { cl01: SET_A, cl02: SET_B } });
    const b = computePlanHash({ ...baseHashInput(), sitelinks_set_per_group: { cl02: SET_B, cl01: SET_A } });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// uploadCampaignBundle — per-group id wiring with campaign-level fallback
// ---------------------------------------------------------------------------

describe("uploadCampaignBundle — per-group sitelinks/callout id wiring", () => {
  const mockExecuteApiCall = vi.mocked(executeApiCall);
  const mockResolveAccount = vi.mocked(resolveAccount);
  const mockParseCsv = vi.mocked(parseKeyCollectorCsv);
  const mockOpenLedger = vi.mocked(openLedger);
  const mockBuildAdGroupPayload = vi.mocked(buildAdGroupPayload);
  const mockBuildKeywordPayload = vi.mocked(buildKeywordPayload);
  const mockBuildResponsiveAdPayload = vi.mocked(buildResponsiveAdPayload);

  const clusterMap = new Map([
    ["cl01", [{ query: "запрос один", intent: "transactional", cluster_id: "cl01", marker: "запрос один", freq: 100 }]],
    ["cl02", [{ query: "запрос два", intent: "transactional", cluster_id: "cl02", marker: "запрос два", freq: 100 }]],
  ]);

  const mockLedger = {
    writePending: vi.fn().mockResolvedValue(undefined),
    writeCommitted: vi.fn().mockResolvedValue(undefined),
    writeFailed: vi.fn().mockResolvedValue(undefined),
    readAll: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const baseInput = {
    csv_path: "/fake/test.csv",
    campaign_strategy: { mode: "one-per-cluster" as const },
    campaign_type: "search" as const,
    site_url: "https://test.example.com",
    daily_budget_amount: 300_000_000,
    region_ids: [213],
    bidding_strategy_type: "WB_DAILY_BUDGET" as const,
    ad_template_strategy: "fallback-template" as const,
    canary_percent: 100, // process all clusters in the canary stage
    max_clusters: 2,
    abort_on_error_rate: 1.0,
    // Campaign-level ids + per-group overrides for cl01 only
    sitelinks_set_id: 555,
    callout_ids: [1, 2],
    sitelinks_set_id_per_group: { cl01: 777 },
    callout_ids_per_group: { cl01: [11, 12] },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockResolveAccount.mockReturnValue({
      label: "test-account",
      id: 1,
      yandex_login: "test-login",
    } as ReturnType<typeof resolveAccount>);

    mockParseCsv.mockReturnValue({
      clusters: clusterMap,
      sha256: "deadbeef1234",
      total_clusters: 2,
      total_rows: 2,
      encoding_used: "utf-8-sig",
    } as unknown as ReturnType<typeof parseKeyCollectorCsv>);

    mockOpenLedger.mockResolvedValue(mockLedger as unknown as Awaited<ReturnType<typeof openLedger>>);

    mockBuildAdGroupPayload.mockReturnValue({ method: "add", params: { AdGroups: [{}] as [unknown] } });
    mockBuildKeywordPayload.mockReturnValue({ method: "add", params: { Keywords: [{}] as [unknown] } });
    mockBuildResponsiveAdPayload.mockReturnValue({ method: "add", params: { Ads: [{}] as [unknown] } });

    let campaignId = 1000;
    let adGroupId = 5000;
    let adId = 7000;
    mockExecuteApiCall.mockImplementation(async (opts: ExecuteOpts) => {
      const body = opts.body as Record<string, unknown> | undefined;
      if (opts.endpoint === "/json/v501/campaigns") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: ++campaignId }] } }, body: {} };
      }
      if (opts.endpoint === "/json/v5/adgroups") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: ++adGroupId }] } }, body: {} };
      }
      if (opts.endpoint === "/json/v5/keywords") {
        if (body?.["method"] === "get") {
          return {
            ok: true, status: 200,
            data: { result: { Keywords: [{ Id: 9901, Keyword: "---autotargeting" }] } },
            body: {},
          };
        }
        if (body?.["method"] === "update") {
          return { ok: true, status: 200, data: { result: { UpdateResults: [{ Id: 9901 }] } }, body: {} };
        }
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 6001 }] } }, body: {} };
      }
      if (opts.endpoint === "/json/v501/ads") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: ++adId }] } }, body: {} };
      }
      return { ok: false, status: 500, body: { error: "unexpected" } };
    });
  });

  it("group with override uses per-group ids; group without falls back to campaign-level", async () => {
    // Dry-run first to obtain a valid plan_hash + ack (per-group id maps are NOT hashed)
    const dry = await uploadCampaignBundle({ ...baseInput, dry_run: true });
    const live = await uploadCampaignBundle({
      ...baseInput,
      dry_run: false,
      confirm: true,
      plan_hash: dry.plan_hash!,
      acknowledge_live: dry.expected_ack_live!,
    });

    expect(live.errors).toEqual([]);
    expect(live.ads_created.length).toBe(2);

    // One combinatorial ResponsiveAd per group. Fallback-template Titles pool equals
    // the cluster_id — use it to identify which group each ad call belongs to.
    const adCalls = mockBuildResponsiveAdPayload.mock.calls.map((args) => args[0] as Record<string, unknown>);
    expect(adCalls).toHaveLength(2);

    const cl01Call = adCalls.find((c) => (c["Titles"] as string[])?.[0] === "cl01");
    const cl02Call = adCalls.find((c) => (c["Titles"] as string[])?.[0] === "cl02");
    expect(cl01Call).toBeDefined();
    expect(cl02Call).toBeDefined();

    // cl01 has an override → group-level ids
    expect(cl01Call!["SitelinkSetId"]).toBe(777);
    expect(cl01Call!["AdExtensionIds"]).toEqual([11, 12]);

    // cl02 has no override → campaign-level ids
    expect(cl02Call!["SitelinkSetId"]).toBe(555);
    expect(cl02Call!["AdExtensionIds"]).toEqual([1, 2]);
  });

  // Regression (stage-8 live bug): campaign-level callouts/sitelinks used to break the
  // live run — callout_ids were created BETWEEN dry-run and live and were part of
  // plan_hash, so stage 1 always failed with "plan_hash mismatch". The hash now binds
  // callout CONTENT; live-created ids (callout_ids / sitelinks_set_id) are excluded.
  it("regression: dry-run plan_hash stays valid at live when live-created ids appear (campaign callouts+sitelinks)", async () => {
    const contentInput = {
      ...baseInput,
      // content inputs known at BOTH stages (what direct-upload-from-yaml passes)
      callouts: ["Гарантия 2 года", "Доставка по РФ"],
      sitelinks_set: SET_A,
      // no ids at dry-run time
      sitelinks_set_id: undefined,
      callout_ids: undefined,
      sitelinks_set_id_per_group: undefined,
      callout_ids_per_group: undefined,
    };
    const dry = await uploadCampaignBundle({ ...contentInput, dry_run: true });

    // Live: same content + ids created by the dep-creation step in between
    const live = await uploadCampaignBundle({
      ...contentInput,
      dry_run: false,
      confirm: true,
      plan_hash: dry.plan_hash!,
      acknowledge_live: dry.expected_ack_live!,
      sitelinks_set_id: 101,
      callout_ids: [201, 202],
    });

    // Before the fix this threw "plan_hash mismatch — inputs changed since dry-run"
    expect(live.stage).toBe("canary_passed");
    expect(live.errors).toEqual([]);
    expect(live.ads_created.length).toBe(2);
  });

  it("fail-closed: editing campaign callout content between dry-run and live rejects the stale plan_hash", async () => {
    const contentInput = {
      ...baseInput,
      callouts: ["Гарантия 2 года", "Доставка по РФ"],
      sitelinks_set_id: undefined,
      callout_ids: undefined,
      sitelinks_set_id_per_group: undefined,
      callout_ids_per_group: undefined,
    };
    const dry = await uploadCampaignBundle({ ...contentInput, dry_run: true });

    await expect(
      uploadCampaignBundle({
        ...contentInput,
        callouts: ["Гарантия 2 года", "ИЗМЕНЁННЫЙ ТЕКСТ"],
        dry_run: false,
        confirm: true,
        plan_hash: dry.plan_hash!,
        acknowledge_live: dry.expected_ack_live!,
        callout_ids: [201, 202],
      })
    ).rejects.toThrow(/plan_hash mismatch/);
  });

  it("without per-group maps all groups use campaign-level ids (previous behavior)", async () => {
    const input = {
      ...baseInput,
      sitelinks_set_id_per_group: undefined,
      callout_ids_per_group: undefined,
    };
    const dry = await uploadCampaignBundle({ ...input, dry_run: true });
    await uploadCampaignBundle({
      ...input,
      dry_run: false,
      confirm: true,
      plan_hash: dry.plan_hash!,
      acknowledge_live: dry.expected_ack_live!,
    });

    const adCalls = mockBuildResponsiveAdPayload.mock.calls.map((args) => args[0] as Record<string, unknown>);
    expect(adCalls).toHaveLength(2);
    for (const call of adCalls) {
      expect(call["SitelinkSetId"]).toBe(555);
      expect(call["AdExtensionIds"]).toEqual([1, 2]);
    }
  });
});
