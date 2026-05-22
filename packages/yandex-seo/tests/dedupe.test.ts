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

import { findExistingCampaignId } from "../src/lib/upload-pipeline.js";
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
      return { ok: false, status: 500, data: {}, body: { error: "unexpected" } };
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
      return { ok: false, status: 500, data: {}, body: { error: "unexpected" } };
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
