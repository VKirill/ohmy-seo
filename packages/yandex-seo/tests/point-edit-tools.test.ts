import { describe, it, expect } from "vitest";

// payload-builder is self-contained (no external imports, no network) — import
// its real builder functions directly, matching strategy.test.ts import style
// (.js suffix, ESM). No vi.mock needed since nothing transitive is pulled in.
import {
  buildBidModifierAddPayload,
  buildBidModifierSetPayload,
  buildBidModifierDeletePayload,
  buildBidModifierGetPayload,
  BID_MODIFIER_EPK_TYPES,
  buildCampaignUpdatePayload,
  buildAdGroupUpdatePayload,
  buildResponsiveAdUpdatePayload,
} from "../src/lib/payload-builder.js";

// ---------------------------------------------------------------------------
// 1-3. BidModifiers add / set / delete
// ---------------------------------------------------------------------------

describe("buildBidModifierAddPayload", () => {
  it("passes the modifiers array straight through (verbatim)", () => {
    const modifiers = [
      { CampaignId: 123, MobileAdjustment: { BidModifier: 120 } },
      { AdGroupId: 456, DesktopAdjustment: { BidModifier: 80 } },
    ];
    const payload = buildBidModifierAddPayload(modifiers);
    expect(payload.method).toBe("add");
    // pass-through: the exact same array reference is embedded, unmodified
    expect(payload.params.BidModifiers).toBe(modifiers);
    expect(payload).toEqual({ method: "add", params: { BidModifiers: modifiers } });
  });
});

describe("buildBidModifierSetPayload", () => {
  it("wraps [{Id, BidModifier}] under set / BidModifiers", () => {
    const modifiers = [{ Id: 777, BidModifier: 150 }];
    const payload = buildBidModifierSetPayload(modifiers);
    expect(payload).toEqual({ method: "set", params: { BidModifiers: modifiers } });
    expect(payload.params.BidModifiers).toBe(modifiers);
  });
});

describe("buildBidModifierDeletePayload", () => {
  it("puts ids under delete / SelectionCriteria.Ids", () => {
    const payload = buildBidModifierDeletePayload([12, 34]);
    expect(payload).toEqual({ method: "delete", params: { SelectionCriteria: { Ids: [12, 34] } } });
  });

  it("preserves STRING ids verbatim (big-int safety, no numeric coercion)", () => {
    const ids = ["102098926600"];
    const payload = buildBidModifierDeletePayload(ids);
    const outIds = payload.params.SelectionCriteria.Ids;
    expect(outIds).toEqual(["102098926600"]);
    expect(typeof outIds[0]).toBe("string");
    expect(outIds[0]).toBe("102098926600");
  });
});

// ---------------------------------------------------------------------------
// 4. BidModifiers get + EPK constants
// ---------------------------------------------------------------------------

describe("buildBidModifierGetPayload", () => {
  it("defaults Levels to ['CAMPAIGN','AD_GROUP'] when not passed", () => {
    const payload = buildBidModifierGetPayload({});
    const sc = payload.params.SelectionCriteria as Record<string, unknown>;
    expect(sc.Levels).toEqual(["CAMPAIGN", "AD_GROUP"]);
  });

  it("emits the exact FieldNames list", () => {
    const payload = buildBidModifierGetPayload({});
    expect(payload.params.FieldNames).toEqual(["Id", "CampaignId", "AdGroupId", "Level", "Type"]);
    expect(payload.method).toBe("get");
  });

  it("with no types, includes the four ЕПК default field-name groups and NOT Demographics", () => {
    const payload = buildBidModifierGetPayload({});
    const params = payload.params as Record<string, unknown>;
    expect(params.MobileAdjustmentFieldNames).toEqual(["BidModifier", "OperatingSystemType"]);
    expect(params.DesktopAdjustmentFieldNames).toEqual(["BidModifier"]);
    expect(params.DesktopOnlyAdjustmentFieldNames).toEqual(["BidModifier"]);
    expect(params.VideoAdjustmentFieldNames).toEqual(["BidModifier"]);
    expect(params.DemographicsAdjustmentFieldNames).toBeUndefined();
  });

  it("with types:['DEMOGRAPHICS'] includes DemographicsAdjustmentFieldNames and drops the ЕПК defaults", () => {
    const payload = buildBidModifierGetPayload({ types: ["DEMOGRAPHICS"] });
    const params = payload.params as Record<string, unknown>;
    expect(params.DemographicsAdjustmentFieldNames).toEqual(["BidModifier", "Age", "Gender"]);
    // an explicit types list replaces the default set entirely
    expect(params.MobileAdjustmentFieldNames).toBeUndefined();
  });

  it("puts campaign_ids into SelectionCriteria.CampaignIds", () => {
    const payload = buildBidModifierGetPayload({ campaign_ids: [123] });
    const sc = payload.params.SelectionCriteria as Record<string, unknown>;
    expect(sc.CampaignIds).toEqual([123]);
  });

  it("exports BID_MODIFIER_EPK_TYPES = ['MOBILE','DESKTOP','DESKTOP_ONLY','VIDEO']", () => {
    expect(BID_MODIFIER_EPK_TYPES).toEqual(["MOBILE", "DESKTOP", "DESKTOP_ONLY", "VIDEO"]);
  });
});

// ---------------------------------------------------------------------------
// 5. Campaign update (top-level + UnifiedCampaign-nested placement)
// ---------------------------------------------------------------------------

function firstCampaign(payload: ReturnType<typeof buildCampaignUpdatePayload>): Record<string, unknown> {
  return payload.params.Campaigns[0] as Record<string, unknown>;
}

describe("buildCampaignUpdatePayload — top-level fields", () => {
  it("maps campaign_id to Id and uses the update method", () => {
    const payload = buildCampaignUpdatePayload({ campaign_id: 555 });
    expect(payload.method).toBe("update");
    expect(firstCampaign(payload).Id).toBe(555);
  });

  it("excluded_sites -> ExcludedSites.Items", () => {
    const c = firstCampaign(buildCampaignUpdatePayload({ campaign_id: 1, excluded_sites: ["a.com"] }));
    expect(c.ExcludedSites).toEqual({ Items: ["a.com"] });
  });

  it("negative_keywords -> NegativeKeywords.Items", () => {
    const c = firstCampaign(buildCampaignUpdatePayload({ campaign_id: 1, negative_keywords: ["x"] }));
    expect(c.NegativeKeywords).toEqual({ Items: ["x"] });
  });

  it("daily_budget_micros -> DailyBudget {Amount, Mode:'STANDARD'}", () => {
    const c = firstCampaign(buildCampaignUpdatePayload({ campaign_id: 1, daily_budget_micros: 10_000_000 }));
    expect(c.DailyBudget).toEqual({ Amount: 10_000_000, Mode: "STANDARD" });
  });

  it("notification and time_targeting sit at top level verbatim", () => {
    const notification = { EmailSettings: { Email: "a@b.c" } };
    const time_targeting = { ConsiderWorkingWeekends: "YES" };
    const c = firstCampaign(buildCampaignUpdatePayload({ campaign_id: 1, notification, time_targeting }));
    expect(c.Notification).toEqual(notification);
    expect(c.TimeTargeting).toEqual(time_targeting);
  });

  it("name sits at top level as Name", () => {
    const c = firstCampaign(buildCampaignUpdatePayload({ campaign_id: 1, name: "New Name" }));
    expect(c.Name).toBe("New Name");
  });
});

describe("buildCampaignUpdatePayload — UnifiedCampaign-nested fields", () => {
  function unifiedOf(input: Parameters<typeof buildCampaignUpdatePayload>[0]): Record<string, unknown> {
    return firstCampaign(buildCampaignUpdatePayload(input)).UnifiedCampaign as Record<string, unknown>;
  }

  it("attribution_model -> UnifiedCampaign.AttributionModel", () => {
    expect(unifiedOf({ campaign_id: 1, attribution_model: "AUTO" }).AttributionModel).toBe("AUTO");
  });

  it("tracking_params -> UnifiedCampaign.TrackingParams", () => {
    expect(unifiedOf({ campaign_id: 1, tracking_params: "utm_source=yd" }).TrackingParams).toBe("utm_source=yd");
  });

  it("settings -> UnifiedCampaign.Settings verbatim", () => {
    const settings = [{ Option: "ADD_METRICA_TAG", Value: "YES" }];
    expect(unifiedOf({ campaign_id: 1, settings }).Settings).toEqual(settings);
  });

  it("bidding_strategy -> UnifiedCampaign.BiddingStrategy verbatim", () => {
    const bidding_strategy = { Search: { BiddingStrategyType: "HIGHEST_POSITION" } };
    expect(unifiedOf({ campaign_id: 1, bidding_strategy }).BiddingStrategy).toEqual(bidding_strategy);
  });

  it("counter_ids -> UnifiedCampaign.CounterIds.Items", () => {
    expect(unifiedOf({ campaign_id: 1, counter_ids: [1] }).CounterIds).toEqual({ Items: [1] });
  });

  it("goal_ids -> UnifiedCampaign.PriorityGoals.Items [{GoalId, Operation:SET, Value:100}]", () => {
    // UPDATE PriorityGoals items require Operation:"SET" (live API rule; ADD/REMOVE rejected).
    expect(unifiedOf({ campaign_id: 1, goal_ids: [9] }).PriorityGoals).toEqual({
      Items: [{ GoalId: 9, Operation: "SET", Value: 100 }],
    });
  });

  it("omits UnifiedCampaign entirely when no unified fields are provided", () => {
    const c = firstCampaign(buildCampaignUpdatePayload({ campaign_id: 1, name: "only-name" }));
    expect("UnifiedCampaign" in c).toBe(false);
  });
});

describe("buildCampaignUpdatePayload — raw merges and minimalism", () => {
  it("raw_fields merge at campaign level; raw_unified_fields merge inside UnifiedCampaign", () => {
    const c = firstCampaign(
      buildCampaignUpdatePayload({
        campaign_id: 1,
        bidding_strategy: { Search: { BiddingStrategyType: "HIGHEST_POSITION" } },
        raw_fields: { BlockedIps: { Items: ["1.2.3.4"] } },
        raw_unified_fields: { SomeRawUnified: 42 },
      }),
    );
    expect(c.BlockedIps).toEqual({ Items: ["1.2.3.4"] });
    const unified = c.UnifiedCampaign as Record<string, unknown>;
    expect(unified.SomeRawUnified).toBe(42);
  });

  it("emits only the provided fields (name only -> {Id, Name})", () => {
    const c = firstCampaign(buildCampaignUpdatePayload({ campaign_id: 42, name: "Solo" }));
    expect(c).toEqual({ Id: 42, Name: "Solo" });
  });
});

// ---------------------------------------------------------------------------
// 6. AdGroup update
// ---------------------------------------------------------------------------

describe("buildAdGroupUpdatePayload", () => {
  it("maps all provided fields onto AdGroups[0]", () => {
    const payload = buildAdGroupUpdatePayload({
      ad_group_id: 321,
      region_ids: [213, 1],
      negative_keywords: ["cheap"],
      tracking_params: "utm_campaign=x",
    });
    expect(payload.method).toBe("update");
    const g = payload.params.AdGroups[0] as Record<string, unknown>;
    expect(g.Id).toBe(321);
    expect(g.RegionIds).toEqual([213, 1]);
    expect(g.NegativeKeywords).toEqual({ Items: ["cheap"] });
    expect(g.TrackingParams).toBe("utm_campaign=x");
  });

  it("emits only provided fields (id only -> {Id})", () => {
    const g = buildAdGroupUpdatePayload({ ad_group_id: 7 }).params.AdGroups[0] as Record<string, unknown>;
    expect(g).toEqual({ Id: 7 });
  });
});

// ---------------------------------------------------------------------------
// 7. ResponsiveAd update — string id safety + ResponsiveAd nesting
// ---------------------------------------------------------------------------

describe("buildResponsiveAdUpdatePayload", () => {
  it("preserves a STRING ad id verbatim (never a number)", () => {
    const payload = buildResponsiveAdUpdatePayload({ ad_id: "1914861097123806822", Titles: ["T"] });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    expect(typeof ad.Id).toBe("string");
    expect(ad.Id).toBe("1914861097123806822");
  });

  it("nests Titles/Texts/Href under Ads[0].ResponsiveAd", () => {
    const payload = buildResponsiveAdUpdatePayload({
      ad_id: "1914861097123806822",
      Titles: ["Title A", "Title B"],
      Texts: ["Body text"],
      Href: "https://example.com/landing",
    });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    const ra = ad.ResponsiveAd as Record<string, unknown>;
    expect(ra.Titles).toEqual(["Title A", "Title B"]);
    expect(ra.Texts).toEqual(["Body text"]);
    expect(ra.Href).toBe("https://example.com/landing");
  });

  it("emits only the provided ResponsiveAd fields (Href only)", () => {
    const payload = buildResponsiveAdUpdatePayload({ ad_id: "1914861097123806822", Href: "https://only-href.example" });
    const ad = payload.params.Ads[0] as Record<string, unknown>;
    expect(ad.ResponsiveAd).toEqual({ Href: "https://only-href.example" });
  });
});
