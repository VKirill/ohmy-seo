import { describe, it, expect, vi } from "vitest";

// epk-settings.ts transitively imports api-gateway.js, which pulls in
// @ohmy-seo/mcp-core subpaths that do not resolve in the test environment.
// hasEpkSettings itself never touches the gateway, so stub it out (same
// pattern as strategy.test.ts) to keep this a pure, no-network unit test.
vi.mock("../src/lib/api-gateway.js", () => ({}));

// payload-builder is pure (no external imports) — tested for real, not mocked.
import { buildBidModifierAdjustment } from "../src/lib/payload-builder.js";
import { hasEpkSettings } from "../src/lib/epk-settings.js";
import { CampaignSchema } from "../src/lib/yaml-schema.js";

// ---------------------------------------------------------------------------
// buildBidModifierAdjustment — friendly spec → API adjustment object
// ---------------------------------------------------------------------------

describe("buildBidModifierAdjustment", () => {
  it("mobile with only bid_modifier omits OperatingSystemType", () => {
    const adj = buildBidModifierAdjustment({ campaign_id: 712, type: "mobile", bid_modifier: 75 });
    expect(adj).toEqual({ CampaignId: 712, MobileAdjustment: { BidModifier: 75 } });
  });

  it("mobile with operating_system_type includes OperatingSystemType", () => {
    const adj = buildBidModifierAdjustment({
      campaign_id: 712,
      type: "mobile",
      bid_modifier: 75,
      operating_system_type: "ANDROID",
    });
    expect(adj).toEqual({
      CampaignId: 712,
      MobileAdjustment: { BidModifier: 75, OperatingSystemType: "ANDROID" },
    });
  });

  it("desktop → DesktopAdjustment", () => {
    const adj = buildBidModifierAdjustment({ campaign_id: 712, type: "desktop", bid_modifier: 50 });
    expect(adj).toEqual({ CampaignId: 712, DesktopAdjustment: { BidModifier: 50 } });
  });

  it("desktop_only → DesktopOnlyAdjustment", () => {
    const adj = buildBidModifierAdjustment({ campaign_id: 712, type: "desktop_only", bid_modifier: 50 });
    expect(adj).toEqual({ CampaignId: 712, DesktopOnlyAdjustment: { BidModifier: 50 } });
  });

  it("video → VideoAdjustment", () => {
    const adj = buildBidModifierAdjustment({ campaign_id: 712, type: "video", bid_modifier: 50 });
    expect(adj).toEqual({ CampaignId: 712, VideoAdjustment: { BidModifier: 50 } });
  });

  it("demographics → DemographicsAdjustment with Age + Gender", () => {
    const adj = buildBidModifierAdjustment({
      campaign_id: 712,
      type: "demographics",
      bid_modifier: 30,
      gender: "GENDER_MALE",
      age: "AGE_25_34",
    });
    expect(adj).toEqual({
      CampaignId: 712,
      DemographicsAdjustment: { BidModifier: 30, Age: "AGE_25_34", Gender: "GENDER_MALE" },
    });
  });

  it("regional → RegionalAdjustment with RegionId", () => {
    const adj = buildBidModifierAdjustment({ campaign_id: 712, type: "regional", bid_modifier: 20, region_id: 225 });
    expect(adj).toEqual({ CampaignId: 712, RegionalAdjustment: { BidModifier: 20, RegionId: 225 } });
  });

  it("retargeting → RetargetingAdjustment with RetargetingConditionId", () => {
    const adj = buildBidModifierAdjustment({
      campaign_id: 712,
      type: "retargeting",
      bid_modifier: 15,
      retargeting_condition_id: 9,
    });
    expect(adj).toEqual({
      CampaignId: 712,
      RetargetingAdjustment: { BidModifier: 15, RetargetingConditionId: 9 },
    });
  });

  it("raw spreads raw_adjustment verbatim alongside the scope", () => {
    const adj = buildBidModifierAdjustment({
      campaign_id: 712,
      type: "raw",
      raw_adjustment: { WeatherAdjustment: { BidModifier: 120 } },
    });
    expect(adj).toEqual({ CampaignId: 712, WeatherAdjustment: { BidModifier: 120 } });
  });

  it("ad_group_id produces AdGroupId scope (not CampaignId)", () => {
    const adj = buildBidModifierAdjustment({ ad_group_id: 5, type: "mobile", bid_modifier: 75 });
    expect(adj).toEqual({ AdGroupId: 5, MobileAdjustment: { BidModifier: 75 } });
    expect((adj as Record<string, unknown>)["CampaignId"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hasEpkSettings — is there anything to apply post-create?
// ---------------------------------------------------------------------------

describe("hasEpkSettings", () => {
  it("undefined → false", () => {
    expect(hasEpkSettings(undefined)).toBe(false);
  });

  it("null → false", () => {
    expect(hasEpkSettings(null)).toBe(false);
  });

  it("empty object → false", () => {
    expect(hasEpkSettings({})).toBe(false);
  });

  it("excluded_sites present → true", () => {
    expect(hasEpkSettings({ excluded_sites: ["x.com"] })).toBe(true);
  });

  it("empty bid_modifiers array → false", () => {
    expect(hasEpkSettings({ bid_modifiers: [] })).toBe(false);
  });

  it("non-empty bid_modifiers → true", () => {
    expect(hasEpkSettings({ bid_modifiers: [{ type: "mobile", bid_modifier: 75 }] })).toBe(true);
  });

  it("attribution_model present → true", () => {
    expect(hasEpkSettings({ attribution_model: "AUTO" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CampaignSchema — epk_settings block is optional + backwards-compatible
// ---------------------------------------------------------------------------

/** Minimal valid campaign object (no epk_settings). */
function makeCampaignObject(extra: Record<string, unknown> = {}) {
  return {
    campaign: {
      Name: "Test-Campaign",
      Type: "TEXT_CAMPAIGN",
      StartDate: "2026-01-01",
      DailyBudget: { Amount: 300_000_000, Currency: "RUB" },
    },
    ...extra,
  };
}

describe("CampaignSchema — epk_settings wiring", () => {
  it("parses a campaign WITH a valid epk_settings block", () => {
    const parsed = CampaignSchema.safeParse(
      makeCampaignObject({
        epk_settings: {
          excluded_sites: ["bad.com"],
          attribution_model: "AUTO",
          bid_modifiers: [{ type: "mobile", bid_modifier: 75 }],
          settings: [{ Option: "ENABLE_AREA_OF_INTEREST_TARGETING", Value: "YES" }],
        },
      }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.epk_settings?.bid_modifiers?.[0]?.type).toBe("mobile");
    }
  });

  it("parses a campaign WITHOUT epk_settings (backwards-compatible)", () => {
    const parsed = CampaignSchema.safeParse(makeCampaignObject());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.epk_settings).toBeUndefined();
    }
  });

  it("rejects an invalid attribution_model (long name, not a short code)", () => {
    const parsed = CampaignSchema.safeParse(
      makeCampaignObject({
        epk_settings: { attribution_model: "LAST_CLICK" },
      }),
    );
    expect(parsed.success).toBe(false);
  });
});
