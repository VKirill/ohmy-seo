/**
 * Tests for the confirm-gate invariant in runDirectUploadFromYaml:
 *   - When dry_run=true OR confirm is missing/false OR plan_hash is absent,
 *     NO dependency-creation API calls (sitelinks/promo/callouts/images) are made.
 *   - When confirm=true AND plan_hash present but acknowledge_live wrong/missing:
 *     ZERO dep API calls, returns plan_needed error.
 *   - When confirm=true AND plan_hash AND valid acknowledge_live AND dep failure:
 *     uploadCampaignBundle NOT called, dep_errors in response.
 *   - When confirm=true AND plan_hash AND valid acknowledge_live AND clean deps:
 *     uploadCampaignBundle IS called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock all external modules BEFORE importing the module under test
// ---------------------------------------------------------------------------

// We'll replace these with controllable spies
const mockExecuteApiCall = vi.fn();
const mockUploadCampaignBundle = vi.fn();
const mockRunDirectUploadImage = vi.fn();
const mockLoadCampaignFolder = vi.fn();
const mockResolveRefs = vi.fn();
const mockBuildSitelinksSetPayload = vi.fn();
const mockBuildPromoExtensionPayload = vi.fn();
const mockBuildCalloutPayload = vi.fn();

vi.mock("../src/lib/api-gateway.js", () => ({
  executeApiCall: (...args: unknown[]) => mockExecuteApiCall(...args),
}));

vi.mock("../src/lib/upload-pipeline.js", () => ({
  uploadCampaignBundle: (...args: unknown[]) => mockUploadCampaignBundle(...args),
}));

vi.mock("../src/tools/direct-upload-image.js", () => ({
  runDirectUploadImage: (...args: unknown[]) => mockRunDirectUploadImage(...args),
}));

vi.mock("../src/lib/yaml-loader.js", () => ({
  loadCampaignFolder: (...args: unknown[]) => mockLoadCampaignFolder(...args),
  resolveRefs: (...args: unknown[]) => mockResolveRefs(...args),
}));

vi.mock("../src/lib/payload-builder.js", () => ({
  buildSitelinksSetPayload: (...args: unknown[]) => mockBuildSitelinksSetPayload(...args),
  buildPromoExtensionPayload: (...args: unknown[]) => mockBuildPromoExtensionPayload(...args),
  buildCalloutPayload: (...args: unknown[]) => mockBuildCalloutPayload(...args),
}));

vi.mock("../src/lib/account-resolver.js", () => ({
  resolveAccount: () => ({ yandex_login: "testlogin", label: "testlogin" }),
}));
vi.mock("../src/lib/scopes.js", () => ({ SCOPES: { DIRECT_API: "direct:api" } }));
vi.mock("../src/lib/csv-parser.js", () => ({}));
vi.mock("../src/lib/bundle-ledger.js", () => ({}));

vi.mock("@ohmy-seo/mcp-core/errors", () => ({
  errorToMcpContent: (e: unknown) => ({
    content: [{ type: "text", text: String(e) }],
  }),
}));

// Import after mocks
import { runDirectUploadFromYaml } from "../src/tools/direct-upload-from-yaml.js";
import { validateLiveAck } from "../src/lib/api/confirm-gate.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// plan_hash is 14 chars; .slice(0,12) = "abc123planHa"
const TEST_PLAN_HASH = "abc123planHash";
const TEST_ACK_VALID = "I-UNDERSTAND-BUNDLE-LIVE:testlogin:abc123planHa";
const TEST_ACK_WRONG = "I-UNDERSTAND-BUNDLE-LIVE:testlogin:WRONGPREFIX";

/** Minimal valid bundle returned by loadCampaignFolder */
function makeBundle(opts: {
  hasSitelinks?: boolean;
  hasPromo?: boolean;
  hasCallouts?: boolean;
  hasImages?: boolean;
} = {}) {
  return {
    validation_errors: [],
    campaign: {
      campaign: {
        Name: "Test Campaign",
        Type: "TEXT_CAMPAIGN",
        StartDate: "2026-01-01",
        DailyBudget: { Amount: 300_000_000, Currency: "RUB" },
        TextCampaign: {
          BiddingStrategy: {
            Search: { BiddingStrategyType: "HIGHEST_POSITION" },
          },
        },
      },
      upload_strategy: "one-per-cluster",
      dedupe_by_name: false,
      sitelinks_set: opts.hasSitelinks ? { Sitelinks: [{ Title: "Link", Href: "https://example.com" }] } : undefined,
      promo_extension: opts.hasPromo
        ? { AdExtension: { Type: "PROMOTION", Promotion: {} } }
        : undefined,
      callouts: opts.hasCallouts ? ["Free shipping", "24/7 support"] : undefined,
      images: opts.hasImages
        ? { hero: { url: "https://example.com/img.jpg" } }
        : undefined,
    },
    groups: [
      {
        group: { Name: "cl01_test", Type: "TEXT_AD_GROUP", RegionIds: [213] },
        keywords: [{ Keyword: "test keyword" }],
        ads: [
          {
            Type: "TEXT_AD" as const,
            TextAd: {
              Title: "Test Title",
              Title2: "Subtitle",
              Text: "Ad text here",
              Href: "https://example.com",
            },
          },
        ],
        _meta: { cluster_id: "cl01", intent: "transactional" },
      },
    ],
  };
}

/** Successful sitelinks API response */
function sitelinksOkResponse(id: number) {
  return {
    ok: true,
    data: { result: { AddResults: [{ Id: id }] } },
  };
}

/** Failed sitelinks API response (HTTP error) */
const sitelinksHttpErrorResponse = { ok: false, body: "Internal Server Error" };

/** AddResults with item-level Errors */
function sitelinksItemErrorResponse() {
  return {
    ok: true,
    data: {
      result: {
        AddResults: [{ Errors: [{ Message: "Invalid sitelink" }] }],
      },
    },
  };
}

/** Minimal plan result returned by uploadCampaignBundle for dry_run=true */
const planResult = {
  dry_run: true,
  plan_hash: TEST_PLAN_HASH,
  expected_ack_live: TEST_ACK_VALID,
  next_actions: ["Re-call with dry_run=false, confirm=true, ..."],
  total_clusters: 1,
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
  recovery_command: "",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDirectUploadFromYaml — confirm gate invariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCampaignFolder.mockReturnValue(makeBundle({ hasSitelinks: true, hasPromo: true, hasCallouts: true, hasImages: true }));
    mockResolveRefs.mockImplementation((bundle: unknown) => bundle);
    mockUploadCampaignBundle.mockResolvedValue(planResult);
    mockBuildSitelinksSetPayload.mockReturnValue({});
    mockBuildPromoExtensionPayload.mockReturnValue({});
    mockBuildCalloutPayload.mockReturnValue({});
  });

  it("dry_run=true: ZERO dependency API calls, returns plan stage", async () => {
    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: true,
    });

    expect(mockExecuteApiCall).not.toHaveBeenCalled();
    expect(mockRunDirectUploadImage).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("dry_run");
  });

  it("dry_run=false but confirm missing: ZERO dependency API calls, returns plan_needed", async () => {
    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      plan_hash: TEST_PLAN_HASH,
      // confirm NOT provided
    });

    expect(mockExecuteApiCall).not.toHaveBeenCalled();
    expect(mockRunDirectUploadImage).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("plan_needed");
    expect(text.reason).toMatch(/confirm/i);
  });

  it("dry_run=false, confirm=false: ZERO dependency API calls, returns plan_needed", async () => {
    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      plan_hash: TEST_PLAN_HASH,
      confirm: false,
    });

    expect(mockExecuteApiCall).not.toHaveBeenCalled();
    expect(mockRunDirectUploadImage).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("plan_needed");
  });

  it("dry_run=false, confirm=true but plan_hash missing: ZERO dependency API calls, returns plan_needed", async () => {
    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      // plan_hash NOT provided
    });

    expect(mockExecuteApiCall).not.toHaveBeenCalled();
    expect(mockRunDirectUploadImage).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("plan_needed");
    expect(text.reason).toMatch(/plan_hash/i);
  });

  // Critical #1: wrong acknowledge_live must be rejected BEFORE any dep creation
  it("confirm=true + plan_hash + WRONG acknowledge_live: ZERO dep API calls, returns plan_needed", async () => {
    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: TEST_PLAN_HASH,
      acknowledge_live: TEST_ACK_WRONG,
    });

    // Must NOT call any dep-creation side effects
    expect(mockExecuteApiCall).not.toHaveBeenCalled();
    expect(mockRunDirectUploadImage).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("plan_needed");
    expect(text.reason).toMatch(/acknowledge_live/i);
  });

  it("confirm=true + plan_hash + MISSING acknowledge_live: ZERO dep API calls, returns plan_needed", async () => {
    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: TEST_PLAN_HASH,
      // acknowledge_live not provided
    });

    expect(mockExecuteApiCall).not.toHaveBeenCalled();
    expect(mockRunDirectUploadImage).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("plan_needed");
    expect(text.reason).toMatch(/acknowledge_live/i);
  });

  it("confirm=true + plan_hash + valid acknowledge_live: dependency API calls ARE made", async () => {
    // For live path, uploadCampaignBundle resolves to a live result
    const liveResult = {
      dry_run: false,
      plan_hash: TEST_PLAN_HASH,
      campaigns_created: [12345],
      ad_groups_created: [],
      keywords_added: 5,
      ads_created: [],
      images_uploaded: [],
      metrika_linked: false,
      canary_passed: true,
      total_clusters: 1,
      clusters_processed: 1,
      ledger_path: "/data/ledger.jsonl",
      errors: [],
      recovery_command: "",
      next_actions: [],
    };
    mockUploadCampaignBundle.mockResolvedValue(liveResult);
    mockExecuteApiCall.mockResolvedValue(sitelinksOkResponse(101));
    mockRunDirectUploadImage.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ ad_image_hash: "hashXYZ" }) }],
    });

    await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: TEST_PLAN_HASH,
      acknowledge_live: TEST_ACK_VALID,
    });

    // At least sitelinks + promo + callouts endpoints should have been called
    expect(mockExecuteApiCall).toHaveBeenCalled();
    expect(mockRunDirectUploadImage).toHaveBeenCalled();
  });
});

describe("runDirectUploadFromYaml — dep creation failure aborts campaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveRefs.mockImplementation((bundle: unknown) => bundle);
    mockBuildSitelinksSetPayload.mockReturnValue({});
    mockBuildPromoExtensionPayload.mockReturnValue({});
    mockBuildCalloutPayload.mockReturnValue({});
    // Default uploadCampaignBundle for live path — should NOT be called when deps fail
    mockUploadCampaignBundle.mockResolvedValue({
      dry_run: false,
      plan_hash: TEST_PLAN_HASH,
      campaigns_created: [],
      ad_groups_created: [],
      keywords_added: 0,
      ads_created: [],
      images_uploaded: [],
      metrika_linked: false,
      canary_passed: false,
      total_clusters: 1,
      clusters_processed: 0,
      ledger_path: "",
      errors: [],
      recovery_command: "",
      next_actions: [],
    });
  });

  // Critical #3: dep failure must abort before uploadCampaignBundle
  it("HTTP error on sitelinks: uploadCampaignBundle NOT called, dep_errors in response", async () => {
    mockLoadCampaignFolder.mockReturnValue(makeBundle({ hasSitelinks: true }));
    mockExecuteApiCall.mockResolvedValue(sitelinksHttpErrorResponse);

    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: TEST_PLAN_HASH,
      acknowledge_live: TEST_ACK_VALID,
    });

    // Campaign bundle must NOT be called — deps failed
    expect(mockUploadCampaignBundle).not.toHaveBeenCalledWith(
      expect.objectContaining({ dry_run: false })
    );

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("dep_creation_failed");
    expect(text.dep_errors).toBeDefined();
    expect(text.dep_errors).toHaveLength(1);
    expect(text.dep_errors[0]).toMatch(/sitelinks.*failed/i);
  });

  it("item-level Errors in AddResults: uploadCampaignBundle NOT called, dep_errors in response", async () => {
    mockLoadCampaignFolder.mockReturnValue(makeBundle({ hasSitelinks: true }));
    mockExecuteApiCall.mockResolvedValue(sitelinksItemErrorResponse());

    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: TEST_PLAN_HASH,
      acknowledge_live: TEST_ACK_VALID,
    });

    expect(mockUploadCampaignBundle).not.toHaveBeenCalledWith(
      expect.objectContaining({ dry_run: false })
    );

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("dep_creation_failed");
    expect(text.dep_errors).toBeDefined();
    expect(text.dep_errors[0]).toMatch(/Invalid sitelink/);
  });

  it("image upload failure: uploadCampaignBundle NOT called, dep_errors captures the failed image name", async () => {
    mockLoadCampaignFolder.mockReturnValue(makeBundle({ hasImages: true }));
    mockRunDirectUploadImage.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ error: "upload failed" }) }],
    });

    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: TEST_PLAN_HASH,
      acknowledge_live: TEST_ACK_VALID,
    });

    expect(mockUploadCampaignBundle).not.toHaveBeenCalledWith(
      expect.objectContaining({ dry_run: false })
    );

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("dep_creation_failed");
    expect(text.dep_errors).toBeDefined();
    expect(text.dep_errors[0]).toMatch(/hero/);
  });

  it("wrong-login ack: uploadCampaignBundle NOT called (live), returns plan_needed", async () => {
    // ack has correct hash but WRONG login
    const wrongLoginAck = "I-UNDERSTAND-BUNDLE-LIVE:wronglogin:abc123planHa";
    mockLoadCampaignFolder.mockReturnValue(makeBundle({ hasSitelinks: true }));

    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: TEST_PLAN_HASH,
      acknowledge_live: wrongLoginAck,
    });

    // Wrong login must be rejected — NO dep API calls
    expect(mockExecuteApiCall).not.toHaveBeenCalled();
    expect(mockRunDirectUploadImage).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("plan_needed");
    expect(text.reason).toMatch(/acknowledge_live/i);
  });

  it("extra-segment ack: uploadCampaignBundle NOT called (live), returns plan_needed", async () => {
    // ack has correct login+hash but an extra segment after
    const extraSegmentAck = "I-UNDERSTAND-BUNDLE-LIVE:testlogin:abc123planHa:extra";
    mockLoadCampaignFolder.mockReturnValue(makeBundle({ hasSitelinks: true }));

    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: TEST_PLAN_HASH,
      acknowledge_live: extraSegmentAck,
    });

    expect(mockExecuteApiCall).not.toHaveBeenCalled();

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("plan_needed");
  });

  it("successful deps: uploadCampaignBundle IS called and dep_errors absent in response", async () => {
    mockLoadCampaignFolder.mockReturnValue(makeBundle({ hasSitelinks: true }));
    mockExecuteApiCall.mockResolvedValue(sitelinksOkResponse(42));

    const liveResult = {
      dry_run: false,
      plan_hash: TEST_PLAN_HASH,
      campaigns_created: [99],
      ad_groups_created: [],
      keywords_added: 1,
      ads_created: [],
      images_uploaded: [],
      metrika_linked: false,
      canary_passed: false,
      total_clusters: 1,
      clusters_processed: 1,
      ledger_path: "",
      errors: [],
      recovery_command: "",
      next_actions: [],
    };
    mockUploadCampaignBundle.mockResolvedValue(liveResult);

    const result = await runDirectUploadFromYaml({
      folder: "/fake/folder",
      dry_run: false,
      confirm: true,
      plan_hash: TEST_PLAN_HASH,
      acknowledge_live: TEST_ACK_VALID,
    });

    // uploadCampaignBundle must have been called (live run)
    expect(mockUploadCampaignBundle).toHaveBeenCalledWith(
      expect.objectContaining({ dry_run: false })
    );

    const text = JSON.parse((result as { content: { text: string }[] }).content[0].text);
    expect(text.stage).toBe("live_orchestration");
    expect(text.dep_errors).toBeUndefined();
    expect(text.context_created.sitelinks_set_id).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// validateLiveAck — exact-match unit tests (P0 #1)
// ---------------------------------------------------------------------------

describe("validateLiveAck — exact string equality", () => {
  const login = "mylogin";
  const planHash = "aabbccddeeff1122"; // 16 chars; slice(0,12) = "aabbccddeeff"

  it("accepts the exact expected ack string", () => {
    expect(validateLiveAck("I-UNDERSTAND-BUNDLE-LIVE:mylogin:aabbccddeeff", login, planHash)).toBe(true);
  });

  it("rejects ack with wrong login", () => {
    expect(validateLiveAck("I-UNDERSTAND-BUNDLE-LIVE:wronglogin:aabbccddeeff", login, planHash)).toBe(false);
  });

  it("rejects ack with extra segment after hash", () => {
    expect(validateLiveAck("I-UNDERSTAND-BUNDLE-LIVE:mylogin:aabbccddeeff:extra", login, planHash)).toBe(false);
  });

  it("rejects ack with wrong hash prefix", () => {
    expect(validateLiveAck("I-UNDERSTAND-BUNDLE-LIVE:mylogin:000000000000", login, planHash)).toBe(false);
  });

  it("rejects ack with prefix-only login match (login is prefix of actual login)", () => {
    // 'myl' is a prefix of 'mylogin' — must be rejected
    expect(validateLiveAck("I-UNDERSTAND-BUNDLE-LIVE:myl:aabbccddeeff", login, planHash)).toBe(false);
  });

  it("rejects undefined ack", () => {
    expect(validateLiveAck(undefined, login, planHash)).toBe(false);
  });

  it("rejects empty ack", () => {
    expect(validateLiveAck("", login, planHash)).toBe(false);
  });

  it("rejects ack missing the login segment (only prefix + hash)", () => {
    // Format: I-UNDERSTAND-BUNDLE-LIVE:aabbccddeeff (no login)
    expect(validateLiveAck("I-UNDERSTAND-BUNDLE-LIVE:aabbccddeeff", login, planHash)).toBe(false);
  });
});
