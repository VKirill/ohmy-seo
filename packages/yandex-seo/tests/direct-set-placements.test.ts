import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecuteApiCall = vi.fn();

vi.mock("../src/lib/api-gateway.js", () => ({
  executeApiCall: (...args: unknown[]) => mockExecuteApiCall(...args),
}));

vi.mock("@ohmy-seo/mcp-core/errors", () => ({
  errorToMcpContent: (e: unknown) => ({
    content: [{ type: "text", text: String(e) }],
  }),
}));

import { runDirectSetPlacements } from "../src/tools/direct-set-placements.js";

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe("runDirectSetPlacements", () => {
  beforeEach(() => {
    mockExecuteApiCall.mockReset();
    delete process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS;
    delete process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS;
  });

  it("fetches and returns placements on action='get'", async () => {
    mockExecuteApiCall.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        result: {
          Campaigns: [
            {
              Id: 714787614,
              Name: "Aura Lab · Карты",
              Type: "UNIFIED_CAMPAIGN",
              State: "SUSPENDED",
              Status: "ACCEPTED",
              UnifiedCampaign: {
                BiddingStrategy: {
                  Search: {
                    BiddingStrategyType: "HIGHEST_POSITION",
                    PlacementTypes: {
                      SearchResults: "NO",
                      Maps: "YES",
                      ProductGallery: "NO",
                      DynamicPlaces: "NO",
                      SearchOrganizationList: "NO",
                    },
                  },
                },
              },
            },
          ],
        },
      },
    });

    const res = parse(await runDirectSetPlacements({ campaign_id: 714787614, action: "get" }));
    expect(res.ok).toBe(true);
    expect(res.campaign_id).toBe(714787614);
    expect(res.bidding_strategy_type).toBe("HIGHEST_POSITION");
    expect(res.placements).toEqual({
      search_results: false,
      maps: true,
      product_gallery: false,
      dynamic_places: false,
      search_organization_list: false,
    });

    const callArgs = mockExecuteApiCall.mock.calls[0][0];
    expect(callArgs.endpoint).toBe("/json/v501/campaigns");
    expect(callArgs.body.params.UnifiedCampaignSearchStrategyPlacementTypesFieldNames).toEqual([
      "SearchResults",
      "ProductGallery",
      "DynamicPlaces",
      "Maps",
      "SearchOrganizationList",
    ]);
  });

  it("requires live mutation env vars and confirm:true for action='set'", async () => {
    mockExecuteApiCall.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        result: {
          Campaigns: [
            {
              Id: 714787614,
              UnifiedCampaign: { BiddingStrategy: { Search: { BiddingStrategyType: "HIGHEST_POSITION" } } },
            },
          ],
        },
      },
    });

    const out1 = await runDirectSetPlacements({
      campaign_id: 714787614,
      action: "set",
      maps: true,
      confirm: true,
    });
    expect(out1.content[0].text).toContain("OHMY_SEO_ALLOW_LIVE_MUTATIONS=true required");

    process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS = "true";
    process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS = "true";

    mockExecuteApiCall.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        result: {
          Campaigns: [
            {
              Id: 714787614,
              UnifiedCampaign: { BiddingStrategy: { Search: { BiddingStrategyType: "HIGHEST_POSITION" } } },
            },
          ],
        },
      },
    });

    const out2 = await runDirectSetPlacements({
      campaign_id: 714787614,
      action: "set",
      maps: true,
      confirm: false,
    });
    expect(out2.content[0].text).toContain("confirm: true required");
  });

  it("updates placements preserving existing strategy params", async () => {
    process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS = "true";
    process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS = "true";

    mockExecuteApiCall
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          result: {
            Campaigns: [
              {
                Id: 714783501,
                Name: "Aura Lab · Поиск",
                UnifiedCampaign: {
                  BiddingStrategy: {
                    Search: {
                      BiddingStrategyType: "WB_MAXIMUM_CLICKS",
                      WbMaximumClicks: { WeeklySpendLimit: 50000000 },
                      PlacementTypes: {
                        SearchResults: "YES",
                        Maps: "YES",
                        ProductGallery: "YES",
                        DynamicPlaces: "YES",
                        SearchOrganizationList: "YES",
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          result: {
            UpdateResults: [{ Id: 714783501, Errors: [] }],
          },
        },
      });

    const res = parse(
      await runDirectSetPlacements({
        campaign_id: 714783501,
        maps: false,
        product_gallery: false,
        dynamic_places: false,
        search_organization_list: false,
        confirm: true,
      }),
    );

    expect(res.ok).toBe(true);
    expect(res.updated_placements).toEqual({
      search_results: true,
      maps: false,
      product_gallery: false,
      dynamic_places: false,
      search_organization_list: false,
    });

    const updateCall = mockExecuteApiCall.mock.calls[1][0];
    expect(updateCall.endpoint).toBe("/json/v501/campaigns");
    expect(updateCall.body.params.Campaigns[0]).toEqual({
      Id: 714783501,
      UnifiedCampaign: {
        BiddingStrategy: {
          Search: {
            BiddingStrategyType: "WB_MAXIMUM_CLICKS",
            WbMaximumClicks: { WeeklySpendLimit: 50000000 },
            PlacementTypes: {
              SearchResults: "YES",
              Maps: "NO",
              ProductGallery: "NO",
              DynamicPlaces: "NO",
              SearchOrganizationList: "NO",
            },
          },
        },
      },
    });
  });

  it("rejects disabling all placements", async () => {
    process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS = "true";
    process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS = "true";

    mockExecuteApiCall.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        result: {
          Campaigns: [
            {
              Id: 714783501,
              UnifiedCampaign: {
                BiddingStrategy: {
                  Search: {
                    BiddingStrategyType: "HIGHEST_POSITION",
                    PlacementTypes: {
                      SearchResults: "YES",
                      Maps: "YES",
                      ProductGallery: "YES",
                      DynamicPlaces: "YES",
                      SearchOrganizationList: "YES",
                    },
                  },
                },
              },
            },
          ],
        },
      },
    });

    const res = await runDirectSetPlacements({
      campaign_id: 714783501,
      search_results: false,
      maps: false,
      product_gallery: false,
      dynamic_places: false,
      search_organization_list: false,
      confirm: true,
    });

    expect(res.content[0].text).toContain("Cannot disable all placements");
  });
});
