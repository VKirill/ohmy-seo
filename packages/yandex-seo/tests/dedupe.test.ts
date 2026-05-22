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
  buildCampaignPayload: vi.fn(),
  buildAdGroupPayload: vi.fn(),
  buildKeywordPayload: vi.fn(),
  buildAdTgoPayload: vi.fn(),
  buildAdRsyaPayload: vi.fn(),
  buildImageUploadPayload: vi.fn(),
  buildMetrikaUpdatePayload: vi.fn(),
}));
vi.mock("../src/lib/api/confirm-gate.js", () => ({
  requireConfirmGate: vi.fn(),
}));
vi.mock("../src/lib/scopes.js", () => ({
  SCOPES: { DIRECT_API: "direct" },
}));

import { findExistingCampaignId, fetchExistingCampaigns } from "../src/lib/upload-pipeline.js";
import { executeApiCall, type ExecuteOpts } from "../src/lib/api-gateway.js";
import { resolveAccount } from "../src/lib/account-resolver.js";
import { parseKeyCollectorCsv } from "../src/lib/csv-parser.js";
import { openLedger } from "../src/lib/bundle-ledger.js";
import {
  buildCampaignPayload,
  buildAdGroupPayload,
  buildKeywordPayload,
  buildAdTgoPayload,
} from "../src/lib/payload-builder.js";

// ---------------------------------------------------------------------------
// Pure function tests — no mocks needed
// ---------------------------------------------------------------------------

describe("findExistingCampaignId", () => {
  it("returns Id when campaign with matching Name exists", () => {
    const campaigns = [
      { Id: 999, Name: "Existing-Campaign" },
      { Id: 100, Name: "Another-Campaign" },
    ];
    expect(findExistingCampaignId(campaigns, "Existing-Campaign")).toBe(999);
  });

  it("returns undefined when name not found", () => {
    const campaigns = [{ Id: 999, Name: "Existing-Campaign" }];
    expect(findExistingCampaignId(campaigns, "New-Campaign")).toBeUndefined();
  });

  it("returns undefined for empty list", () => {
    expect(findExistingCampaignId([], "Any-Campaign")).toBeUndefined();
  });

  it("is case-sensitive — does not match different casing", () => {
    const campaigns = [{ Id: 999, Name: "Existing-Campaign" }];
    expect(findExistingCampaignId(campaigns, "existing-campaign")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration: dedupe_by_name flag in uploadCampaignBundle (via processCluster)
// ---------------------------------------------------------------------------

describe("uploadCampaignBundle dedupe_by_name", () => {
  const mockExecuteApiCall = vi.mocked(executeApiCall);
  const mockResolveAccount = vi.mocked(resolveAccount);
  const mockParseCsv = vi.mocked(parseKeyCollectorCsv);
  const mockOpenLedger = vi.mocked(openLedger);
  const mockBuildCampaignPayload = vi.mocked(buildCampaignPayload);
  const mockBuildAdGroupPayload = vi.mocked(buildAdGroupPayload);
  const mockBuildKeywordPayload = vi.mocked(buildKeywordPayload);
  const mockBuildAdTgoPayload = vi.mocked(buildAdTgoPayload);

  // Minimal shared input fields
  const baseInput = {
    csv_path: "/fake/test.csv",
    campaign_strategy: { mode: "one-per-cluster" as const },
    campaign_type: "search" as const,
    site_url: "https://test.example.com",
    daily_budget_amount: 300_000_000,
    region_ids: [213],
    bidding_strategy_type: "WB_DAILY_BUDGET" as const,
    ad_template_strategy: "fallback-template" as const,
    dry_run: false,
    confirm: true,
    acknowledge_live: "",  // will be set after dry run — we force hash match by bypassing plan check
    plan_hash: "",  // overridden per test
    canary_percent: 100, // process all clusters as canary
    max_clusters: 1,
    abort_on_error_rate: 1.0, // never abort on errors
  };

  const clusterMap = new Map([
    ["cl01", [{ query: "test keyword", intent: "informational", cluster_id: "cl01", marker: "test keyword", freq: 100 }]],
  ]);

  // Ledger mock that does nothing
  const mockLedger = {
    writePending: vi.fn().mockResolvedValue(undefined),
    writeCommitted: vi.fn().mockResolvedValue(undefined),
    writeFailed: vi.fn().mockResolvedValue(undefined),
    readAll: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
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
      total_clusters: 1,
      total_rows: 1,
      encoding_used: "utf-8-sig",
    } as unknown as ReturnType<typeof parseKeyCollectorCsv>);

    mockOpenLedger.mockResolvedValue(mockLedger as unknown as Awaited<ReturnType<typeof openLedger>>);

    mockBuildCampaignPayload.mockReturnValue({ method: "add", params: { Campaigns: [{}] as [unknown] } });
    mockBuildAdGroupPayload.mockReturnValue({ method: "add", params: { AdGroups: [{}] as [unknown] } });
    mockBuildKeywordPayload.mockReturnValue({ method: "add", params: { Keywords: [{}] as [unknown] } });
    mockBuildAdTgoPayload.mockReturnValue({ method: "add", params: { Ads: [{}] as [unknown] } });
  });

  it("dedupe_by_name=true: skips Campaigns.add when existing campaign matches by name", async () => {
    // Import here so mocks are active
    const { uploadCampaignBundle } = await import("../src/lib/upload-pipeline.js");

    // First call: Campaigns.get (dedupe pre-fetch) → returns existing campaign
    // Subsequent calls: AdGroups.add, Keywords.add, Ads.add
    mockExecuteApiCall.mockImplementation(async (opts: ExecuteOpts) => {
      const body = opts.body as Record<string, unknown> | undefined;
      // Campaigns.get call — method: "get" in body
      if (
        opts.endpoint === "/json/v5/campaigns" &&
        body?.["method"] === "get"
      ) {
        return {
          ok: true,
          status: 200,
          data: {
            result: {
              Campaigns: [{ Id: 999, Name: "cluster-cl01" }],
            },
          },
          body: {},
        };
      }
      // AdGroups.add
      if (opts.endpoint === "/json/v5/adgroups") {
        return {
          ok: true, status: 200,
          data: { result: { AddResults: [{ Id: 5001 }] } },
          body: {},
        };
      }
      // Keywords.add
      if (opts.endpoint === "/json/v5/keywords") {
        return {
          ok: true, status: 200,
          data: { result: { AddResults: [{ Id: 6001 }] } },
          body: {},
        };
      }
      // Ads.add
      if (opts.endpoint === "/json/v5/ads") {
        return {
          ok: true, status: 200,
          data: { result: { AddResults: [{ Id: 7001 }] } },
          body: {},
        };
      }
      // Fallback
      return { ok: false, status: 500, body: { error: "unexpected" } };
    });

    // We need a valid plan_hash + acknowledge_live — compute them by doing a dry run first
    const dryResult = await uploadCampaignBundle({ ...baseInput, dry_run: true });
    const planHash = dryResult.plan_hash!;
    const ackLive = dryResult.expected_ack_live!;

    const result = await uploadCampaignBundle({
      ...baseInput,
      dedupe_by_name: true,
      plan_hash: planHash,
      acknowledge_live: ackLive,
    });

    // Campaigns.add (POST with method:"add") should NOT have been called
    const campaignAddCalls = mockExecuteApiCall.mock.calls.filter((args) => {
      const opts = args[0] as unknown as Record<string, unknown>;
      const body = opts["body"] as Record<string, unknown> | undefined;
      return opts["endpoint"] === "/json/v5/campaigns" && body?.["method"] !== "get";
    });
    expect(campaignAddCalls).toHaveLength(0);

    // The result should contain Id=999 as a reused campaign (it won't be in campaigns_created
    // since we didn't create it — ad_groups should be created under campaign 999)
    expect(result.errors).toHaveLength(0);
    expect(result.ad_groups_created).toContain(5001);
  });

  it("dedupe_by_name=true: skips ARCHIVED campaign and falls through to create", async () => {
    const { uploadCampaignBundle } = await import("../src/lib/upload-pipeline.js");

    mockExecuteApiCall.mockImplementation(async (opts: ExecuteOpts) => {
      const body = opts.body as Record<string, unknown> | undefined;
      // Campaigns.get — returns campaign in ARCHIVED state
      if (opts.endpoint === "/json/v5/campaigns" && body?.["method"] === "get") {
        return {
          ok: true, status: 200,
          data: { result: { Campaigns: [{ Id: 777, Name: "cluster-cl01", Status: "ARCHIVED" }] } },
          body: {},
        };
      }
      // Campaigns.add — should be called because ARCHIVED is skipped
      if (opts.endpoint === "/json/v5/campaigns") {
        return {
          ok: true, status: 200,
          data: { result: { AddResults: [{ Id: 998 }] } },
          body: {},
        };
      }
      if (opts.endpoint === "/json/v5/adgroups") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 5010 }] } }, body: {} };
      }
      if (opts.endpoint === "/json/v5/keywords") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 6010 }] } }, body: {} };
      }
      if (opts.endpoint === "/json/v5/ads") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 7010 }] } }, body: {} };
      }
      return { ok: false, status: 500, body: { error: "unexpected" } };
    });

    const dryResult = await uploadCampaignBundle({ ...baseInput, dry_run: true });
    const result = await uploadCampaignBundle({
      ...baseInput,
      dedupe_by_name: true,
      plan_hash: dryResult.plan_hash!,
      acknowledge_live: dryResult.expected_ack_live!,
    });

    // Campaigns.add should have been called (ARCHIVED campaign was skipped)
    const campaignAddCalls = mockExecuteApiCall.mock.calls.filter((args) => {
      const opts = args[0] as unknown as Record<string, unknown>;
      const body = opts["body"] as Record<string, unknown> | undefined;
      return opts["endpoint"] === "/json/v5/campaigns" && body?.["method"] !== "get";
    });
    expect(campaignAddCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.campaigns_created).toContain(998);
  });

  it("dedupe_by_name=true: warns on suspicious state (not archived, not normal)", async () => {
    const { uploadCampaignBundle } = await import("../src/lib/upload-pipeline.js");

    mockExecuteApiCall.mockImplementation(async (opts: ExecuteOpts) => {
      const body = opts.body as Record<string, unknown> | undefined;
      if (opts.endpoint === "/json/v5/campaigns" && body?.["method"] === "get") {
        return {
          ok: true, status: 200,
          data: { result: { Campaigns: [{ Id: 555, Name: "cluster-cl01", Status: "UNKNOWN_WEIRD_STATE" }] } },
          body: {},
        };
      }
      if (opts.endpoint === "/json/v5/adgroups") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 5011 }] } }, body: {} };
      }
      if (opts.endpoint === "/json/v5/keywords") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 6011 }] } }, body: {} };
      }
      if (opts.endpoint === "/json/v5/ads") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 7011 }] } }, body: {} };
      }
      return { ok: false, status: 500, body: { error: "unexpected" } };
    });

    const dryResult = await uploadCampaignBundle({ ...baseInput, dry_run: true });
    const result = await uploadCampaignBundle({
      ...baseInput,
      dedupe_by_name: true,
      plan_hash: dryResult.plan_hash!,
      acknowledge_live: dryResult.expected_ack_live!,
    });

    // Campaign was reused (id=555) but a warning should appear in errors
    expect(result.errors.some((e) => e.step === "dedupe" && e.error.includes("UNKNOWN_WEIRD_STATE"))).toBe(true);
  });

  it("dedupe_by_name=false: Campaigns.add IS called (default create behaviour)", async () => {
    const { uploadCampaignBundle } = await import("../src/lib/upload-pipeline.js");

    mockExecuteApiCall.mockImplementation(async (opts: ExecuteOpts) => {
      const endpoint = opts.endpoint;
      if (endpoint === "/json/v5/campaigns") {
        return {
          ok: true, status: 200,
          data: { result: { AddResults: [{ Id: 888 }] } },
          body: {},
        };
      }
      if (endpoint === "/json/v5/adgroups") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 5002 }] } }, body: {} };
      }
      if (endpoint === "/json/v5/keywords") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 6002 }] } }, body: {} };
      }
      if (endpoint === "/json/v5/ads") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 7002 }] } }, body: {} };
      }
      return { ok: false, status: 500, body: { error: "unexpected" } };
    });

    const dryResult = await uploadCampaignBundle({ ...baseInput, dry_run: true });
    const planHash = dryResult.plan_hash!;
    const ackLive = dryResult.expected_ack_live!;

    const result = await uploadCampaignBundle({
      ...baseInput,
      dedupe_by_name: false,
      plan_hash: planHash,
      acknowledge_live: ackLive,
    });

    // Campaigns.add should have been called (no pre-fetch, no dedupe check)
    const campaignAddCalls = mockExecuteApiCall.mock.calls.filter((args) => {
      const opts = args[0] as unknown as Record<string, unknown>;
      return (opts["endpoint"] as string) === "/json/v5/campaigns";
    });
    expect(campaignAddCalls.length).toBeGreaterThanOrEqual(1);

    expect(result.campaigns_created).toContain(888);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findExistingCampaignId — ARCHIVED / suspicious state
// ---------------------------------------------------------------------------

describe("findExistingCampaignId — Status filtering", () => {
  it("returns undefined for ARCHIVED campaign (skip reuse)", () => {
    const campaigns = [{ Id: 111, Name: "Camp-A", Status: "ARCHIVED" }];
    expect(findExistingCampaignId(campaigns, "Camp-A")).toBeUndefined();
  });

  it("returns Id for ACTIVE campaign (normal reuse)", () => {
    const campaigns = [{ Id: 222, Name: "Camp-B", Status: "ACTIVE" }];
    expect(findExistingCampaignId(campaigns, "Camp-B")).toBe(222);
  });

  it("returns Id for DRAFT campaign (normal reuse)", () => {
    const campaigns = [{ Id: 333, Name: "Camp-C", Status: "DRAFT" }];
    expect(findExistingCampaignId(campaigns, "Camp-C")).toBe(333);
  });

  it("returns Id for campaign with no Status field (legacy — assume reusable)", () => {
    const campaigns = [{ Id: 444, Name: "Camp-D" }];
    expect(findExistingCampaignId(campaigns, "Camp-D")).toBe(444);
  });

  it("pushes warning and returns Id for campaign in suspicious state", () => {
    const warnings: Array<{ cluster_id: string; step: string; error: string }> = [];
    const campaigns = [{ Id: 555, Name: "Camp-E", Status: "WEIRD_STATE" }];
    const id = findExistingCampaignId(campaigns, "Camp-E", warnings, "cl99");
    expect(id).toBe(555);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].step).toBe("dedupe");
    expect(warnings[0].error).toContain("WEIRD_STATE");
  });

  it("does not push warning for known normal states", () => {
    const normalStates = ["DRAFT", "ACTIVE", "SUSPENDED", "ENDED", "OFF", "CONVERTED"];
    for (const status of normalStates) {
      const warnings: Array<{ cluster_id: string; step: string; error: string }> = [];
      findExistingCampaignId([{ Id: 1, Name: "X", Status: status }], "X", warnings, "cl00");
      expect(warnings).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// RSYA + TGO ad errors land in state.errors
// ---------------------------------------------------------------------------

describe("uploadCampaignBundle — ad errors surfaced in result.errors", () => {
  const mockExecuteApiCall2 = vi.mocked(executeApiCall);
  const mockResolveAccount2 = vi.mocked(resolveAccount);
  const mockParseCsv2 = vi.mocked(parseKeyCollectorCsv);
  const mockOpenLedger2 = vi.mocked(openLedger);
  const mockBuildCampaignPayload2 = vi.mocked(buildCampaignPayload);
  const mockBuildAdGroupPayload2 = vi.mocked(buildAdGroupPayload);
  const mockBuildKeywordPayload2 = vi.mocked(buildKeywordPayload);
  const mockBuildAdTgoPayload2 = vi.mocked(buildAdTgoPayload);

  const baseInputAds = {
    csv_path: "/fake/ads.csv",
    campaign_strategy: { mode: "one-per-cluster" as const },
    campaign_type: "search" as const,
    site_url: "https://ads.example.com",
    daily_budget_amount: 300_000_000,
    region_ids: [213],
    bidding_strategy_type: "WB_DAILY_BUDGET" as const,
    ad_template_strategy: "fallback-template" as const,
    dry_run: false,
    confirm: true,
    acknowledge_live: "",
    plan_hash: "",
    canary_percent: 100,
    max_clusters: 1,
    abort_on_error_rate: 1.0,
  };

  const clusterMapAds = new Map([
    ["cl02", [{ query: "купить диван", intent: "transactional", cluster_id: "cl02", marker: "купить диван", freq: 50 }]],
  ]);

  const mockLedger2 = {
    writePending: vi.fn().mockResolvedValue(undefined),
    writeCommitted: vi.fn().mockResolvedValue(undefined),
    writeFailed: vi.fn().mockResolvedValue(undefined),
    readAll: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccount2.mockReturnValue({ label: "test-account", id: 1, yandex_login: "test-login" } as ReturnType<typeof resolveAccount>);
    mockParseCsv2.mockReturnValue({
      clusters: clusterMapAds, sha256: "aabbcc", total_clusters: 1, total_rows: 1, encoding_used: "utf-8-sig",
    } as unknown as ReturnType<typeof parseKeyCollectorCsv>);
    mockOpenLedger2.mockResolvedValue(mockLedger2 as unknown as Awaited<ReturnType<typeof openLedger>>);
    mockBuildCampaignPayload2.mockReturnValue({ method: "add", params: { Campaigns: [{}] as [unknown] } });
    mockBuildAdGroupPayload2.mockReturnValue({ method: "add", params: { AdGroups: [{}] as [unknown] } });
    mockBuildKeywordPayload2.mockReturnValue({ method: "add", params: { Keywords: [{}] as [unknown] } });
    mockBuildAdTgoPayload2.mockReturnValue({ method: "add", params: { Ads: [{}] as [unknown] } });
  });

  it("TGO error_code=8000 IS surfaced in state.errors", async () => {
    const { uploadCampaignBundle } = await import("../src/lib/upload-pipeline.js");

    mockExecuteApiCall2.mockImplementation(async (opts: ExecuteOpts) => {
      if (opts.endpoint === "/json/v5/campaigns") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 900 }] } }, body: {} };
      }
      if (opts.endpoint === "/json/v5/adgroups") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 5100 }] } }, body: {} };
      }
      if (opts.endpoint === "/json/v5/keywords") {
        return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 6100 }] } }, body: {} };
      }
      // TGO ad fails with code 8000
      if (opts.endpoint === "/json/v5/ads") {
        return {
          ok: false, status: 200,
          body: { error: { error_code: 8000, error_string: "Validation error" } },
        };
      }
      return { ok: false, status: 500, body: { error: "unexpected" } };
    });

    const dryResult = await uploadCampaignBundle({ ...baseInputAds, dry_run: true });
    const result = await uploadCampaignBundle({
      ...baseInputAds,
      plan_hash: dryResult.plan_hash!,
      acknowledge_live: dryResult.expected_ack_live!,
    });

    // Code 8000 errors must now appear in result.errors
    const adErrors = result.errors.filter((e) => e.step === "ad_create");
    expect(adErrors.length).toBeGreaterThan(0);
    expect(adErrors[0].error).toContain("8000");
  });
});

// ---------------------------------------------------------------------------
// Stage 2 abort on high error rate
// ---------------------------------------------------------------------------

describe("uploadCampaignBundle — Stage 2 aborts on error rate", () => {
  const mockExecuteApiCallS2 = vi.mocked(executeApiCall);
  const mockResolveAccountS2 = vi.mocked(resolveAccount);
  const mockParseCsvS2 = vi.mocked(parseKeyCollectorCsv);
  const mockOpenLedgerS2 = vi.mocked(openLedger);
  const mockBuildCampaignPayloadS2 = vi.mocked(buildCampaignPayload);
  const mockBuildAdGroupPayloadS2 = vi.mocked(buildAdGroupPayload);
  const mockBuildKeywordPayloadS2 = vi.mocked(buildKeywordPayload);
  const mockBuildAdTgoPayloadS2 = vi.mocked(buildAdTgoPayload);

  // Two clusters: one canary + one bulk
  const twoClusters = new Map([
    ["c1", [{ query: "kw1", intent: "informational", cluster_id: "c1", marker: "kw1", freq: 10 }]],
    ["c2", [{ query: "kw2", intent: "informational", cluster_id: "c2", marker: "kw2", freq: 10 }]],
  ]);

  const mockLedgerS2 = {
    writePending: vi.fn().mockResolvedValue(undefined),
    writeCommitted: vi.fn().mockResolvedValue(undefined),
    writeFailed: vi.fn().mockResolvedValue(undefined),
    readAll: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const baseInputS2 = {
    csv_path: "/fake/s2.csv",
    campaign_strategy: { mode: "one-per-cluster" as const },
    campaign_type: "search" as const,
    site_url: "https://s2.example.com",
    daily_budget_amount: 100_000_000,
    region_ids: [1],
    bidding_strategy_type: "WB_DAILY_BUDGET" as const,
    ad_template_strategy: "fallback-template" as const,
    dry_run: false,
    confirm: true,
    acknowledge_live: "",
    plan_hash: "",
    canary_percent: 50,  // 50% of 2 clusters = 1 cluster canary
    max_clusters: 2,
    abort_on_error_rate: 0.3, // trigger abort when ≥30% fail
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccountS2.mockReturnValue({ label: "test-account", id: 1, yandex_login: "test-login" } as ReturnType<typeof resolveAccount>);
    mockParseCsvS2.mockReturnValue({
      clusters: twoClusters, sha256: "s2hash", total_clusters: 2, total_rows: 2, encoding_used: "utf-8-sig",
    } as unknown as ReturnType<typeof parseKeyCollectorCsv>);
    mockOpenLedgerS2.mockResolvedValue(mockLedgerS2 as unknown as Awaited<ReturnType<typeof openLedger>>);
    mockBuildCampaignPayloadS2.mockReturnValue({ method: "add", params: { Campaigns: [{}] as [unknown] } });
    mockBuildAdGroupPayloadS2.mockReturnValue({ method: "add", params: { AdGroups: [{}] as [unknown] } });
    mockBuildKeywordPayloadS2.mockReturnValue({ method: "add", params: { Keywords: [{}] as [unknown] } });
    mockBuildAdTgoPayloadS2.mockReturnValue({ method: "add", params: { Ads: [{}] as [unknown] } });
  });

  it("Stage 2: result.stage is 'bulk_aborted' (not 'completed') when error rate exceeds threshold", async () => {
    const { uploadCampaignBundle } = await import("../src/lib/upload-pipeline.js");

    // Stage 1 (canary): everything succeeds for c1
    // Stage 2 (bulk): c2 campaign fails → 100% error rate → abort
    let s2Phase = false;

    mockExecuteApiCallS2.mockImplementation(async (opts: ExecuteOpts) => {
      // Phase 1: canary — all OK
      if (!s2Phase) {
        if (opts.endpoint === "/json/v5/campaigns") {
          return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 800 }] } }, body: {} };
        }
        if (opts.endpoint === "/json/v5/adgroups") {
          return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 5200 }] } }, body: {} };
        }
        if (opts.endpoint === "/json/v5/keywords") {
          return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 6200 }] } }, body: {} };
        }
        if (opts.endpoint === "/json/v5/ads") {
          return { ok: true, status: 200, data: { result: { AddResults: [{ Id: 7200 }] } }, body: {} };
        }
      }
      // Phase 2: bulk — all fail
      return { ok: false, status: 500, body: { error: "server error" } };
    });

    const dryResult = await uploadCampaignBundle({ ...baseInputS2, dry_run: true });
    const planHash = dryResult.plan_hash!;
    const ackLive = dryResult.expected_ack_live!;

    // Stage 1 canary
    const canaryResult = await uploadCampaignBundle({
      ...baseInputS2,
      plan_hash: planHash,
      acknowledge_live: ackLive,
    });

    expect(canaryResult.stage).toBe("canary_passed");
    s2Phase = true;

    // Compute continuation_ack from canary result
    const continuationAck = canaryResult.expected_continuation_ack!;
    // continuation_ack encodes the committed count e.g. ":6" — extract it
    const committedCount = parseInt(continuationAck.split(":").pop() ?? "0", 10);

    // Prep the ledger mock to return the correct number of committed entries
    // so Stage 2 continuation_ack validation passes
    const priorCommitted = Array.from({ length: committedCount }, (_, i) => ({
      state: "committed" as const,
      op: i === 0 ? "campaign" : i === 1 ? "ad_group" : i === 2 ? "keyword" : "ad_tgo",
      signature: `sig-${i}`,
      returned_id: i === 2 ? undefined : 10000 + i, // keyword has no returned_id number
    }));
    mockLedgerS2.readAll.mockResolvedValue(priorCommitted as never);

    // Stage 2 bulk — errors will exceed abort_on_error_rate=0.3
    const bulkResult = await uploadCampaignBundle({
      ...baseInputS2,
      plan_hash: planHash,
      acknowledge_live: ackLive,
      canary_passed: true,
      continuation_ack: continuationAck,
    });

    expect(bulkResult.stage).toBe("bulk_aborted");
    expect(bulkResult.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// fetchExistingCampaigns — pagination + fail-closed
// ---------------------------------------------------------------------------

describe("fetchExistingCampaigns — pagination and fail-closed", () => {
  const mockExecuteApiCallPag = vi.mocked(executeApiCall);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("paginates: fetches 2 pages when LimitedBy is set", async () => {
    let callCount = 0;
    mockExecuteApiCallPag.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First page: LimitedBy=10000 means there are more
        return {
          ok: true, status: 200,
          data: {
            result: {
              Campaigns: Array.from({ length: 10000 }, (_, i) => ({
                Id: i + 1, Name: `Camp-${i + 1}`, Status: "ACTIVE",
              })),
              LimitedBy: 10000,
            },
          },
          body: {},
        };
      }
      // Second page: no LimitedBy → done
      return {
        ok: true, status: 200,
        data: {
          result: {
            Campaigns: [{ Id: 10001, Name: "Camp-10001", Status: "ACTIVE" }],
          },
        },
        body: {},
      };
    });

    const campaigns = await fetchExistingCampaigns(undefined, undefined);
    expect(campaigns).toHaveLength(10001);
    expect(callCount).toBe(2);
  });

  it("throws on API error (fail-closed — no silent empty array)", async () => {
    mockExecuteApiCallPag.mockResolvedValueOnce({
      ok: false, status: 403,
      body: { error: { error_string: "Access denied" } },
    });

    await expect(fetchExistingCampaigns(undefined, undefined)).rejects.toThrow(
      /fetchExistingCampaigns failed/
    );
  });
});
