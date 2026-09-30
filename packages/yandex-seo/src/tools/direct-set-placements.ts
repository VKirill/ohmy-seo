import { z } from "zod";
import { executeApiCall } from "../lib/api-gateway.js";
import { cleanStrategyObject } from "../lib/payload-builder.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const InputSchema = z.object({
  campaign_id: z.number().int().positive().describe("Campaign ID (ЕПК / UnifiedCampaign)"),
  action: z
    .enum(["get", "set"])
    .optional()
    .describe("Action: 'get' (view current placements) or 'set' (update placements). Defaults to 'set' if any placement flag is passed, otherwise 'get'."),
  search_results: z
    .boolean()
    .optional()
    .describe("Поисковая выдача (SearchResults: YES/NO)"),
  maps: z
    .boolean()
    .optional()
    .describe("Яндекс Карты (Maps: YES/NO)"),
  product_gallery: z
    .boolean()
    .optional()
    .describe("Товарная галерея (ProductGallery: YES/NO)"),
  dynamic_places: z
    .boolean()
    .optional()
    .describe("Динамические места на поиске (DynamicPlaces: YES/NO)"),
  search_organization_list: z
    .boolean()
    .optional()
    .describe("Список организаций в поисковой выдаче (SearchOrganizationList: YES/NO)"),
  confirm: z
    .boolean()
    .optional()
    .describe("Explicit confirmation required for action='set'"),
  acknowledge_live: z
    .string()
    .optional()
    .describe("Live mutation acknowledgement string (optional)"),
  account: z
    .string()
    .min(1)
    .optional()
    .describe("Account label from list_accounts (optional if default configured)"),
  client_login: z
    .string()
    .min(1)
    .optional()
    .describe("Agency client login for sub-client cabinets (optional)"),
});

export type DirectSetPlacementsInput = z.infer<typeof InputSchema>;

const DEFAULT_PLACEMENTS: Record<string, "YES" | "NO"> = {
  SearchResults: "YES",
  ProductGallery: "YES",
  DynamicPlaces: "YES",
  Maps: "YES",
  SearchOrganizationList: "YES",
};

function hasPlacementFlags(input: DirectSetPlacementsInput): boolean {
  return (
    input.search_results !== undefined ||
    input.maps !== undefined ||
    input.product_gallery !== undefined ||
    input.dynamic_places !== undefined ||
    input.search_organization_list !== undefined
  );
}

export async function runDirectSetPlacements(input: DirectSetPlacementsInput) {
  const parsed = InputSchema.parse(input);
  const action = parsed.action ?? (hasPlacementFlags(parsed) ? "set" : "get");

  try {
    // 1. Fetch current campaign details and strategy
    const getRes = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v501/campaigns",
      body: {
        method: "get",
        params: {
          SelectionCriteria: { Ids: [parsed.campaign_id] },
          FieldNames: ["Id", "Name", "Type", "State", "Status"],
          UnifiedCampaignFieldNames: ["BiddingStrategy"],
          UnifiedCampaignSearchStrategyPlacementTypesFieldNames: [
            "SearchResults",
            "ProductGallery",
            "DynamicPlaces",
            "Maps",
            "SearchOrganizationList",
          ],
        },
      },
      account: parsed.account,
      client_login: parsed.client_login,
    });

    if (!getRes.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Failed to fetch campaign details", details: getRes.body }, null, 2),
          },
        ],
      };
    }

    const data = getRes.data as { result?: { Campaigns?: Array<Record<string, unknown>> } };
    const campaigns = data?.result?.Campaigns ?? [];
    if (campaigns.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: `Campaign with ID ${parsed.campaign_id} not found` }, null, 2),
          },
        ],
      };
    }

    const campaign = campaigns[0];
    const unified = (campaign["UnifiedCampaign"] as Record<string, unknown>) ?? {};
    const strategy = (unified["BiddingStrategy"] as Record<string, unknown>) ?? {};
    const searchStrategy = (strategy["Search"] as Record<string, unknown>) ?? {};
    const currentPlacementTypes = (searchStrategy["PlacementTypes"] as Record<string, "YES" | "NO">) ?? DEFAULT_PLACEMENTS;

    if (action === "get") {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ok: true,
                campaign_id: campaign["Id"],
                name: campaign["Name"],
                type: campaign["Type"],
                state: campaign["State"],
                status: campaign["Status"],
                bidding_strategy_type: searchStrategy["BiddingStrategyType"],
                placements: {
                  search_results: currentPlacementTypes.SearchResults === "YES",
                  maps: currentPlacementTypes.Maps === "YES",
                  product_gallery: currentPlacementTypes.ProductGallery === "YES",
                  dynamic_places: currentPlacementTypes.DynamicPlaces === "YES",
                  search_organization_list: currentPlacementTypes.SearchOrganizationList === "YES",
                },
                raw_placement_types: currentPlacementTypes,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    // action === 'set'
    if (process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS !== "true") {
      throw new Error("OHMY_SEO_ALLOW_LIVE_MUTATIONS=true required");
    }
    if (process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS !== "true") {
      throw new Error("YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true required");
    }
    if (parsed.confirm !== true) {
      throw new Error("confirm: true required for action='set'");
    }

    const nextPlacements: Record<string, "YES" | "NO"> = { ...currentPlacementTypes };
    if (parsed.search_results !== undefined) nextPlacements.SearchResults = parsed.search_results ? "YES" : "NO";
    if (parsed.maps !== undefined) nextPlacements.Maps = parsed.maps ? "YES" : "NO";
    if (parsed.product_gallery !== undefined) nextPlacements.ProductGallery = parsed.product_gallery ? "YES" : "NO";
    if (parsed.dynamic_places !== undefined) nextPlacements.DynamicPlaces = parsed.dynamic_places ? "YES" : "NO";
    if (parsed.search_organization_list !== undefined)
      nextPlacements.SearchOrganizationList = parsed.search_organization_list ? "YES" : "NO";

    const enabledCount = Object.values(nextPlacements).filter((v) => v === "YES").length;
    if (enabledCount === 0) {
      throw new Error("Cannot disable all placements. At least one placement must be enabled ('YES').");
    }

    const updatedSearch = cleanStrategyObject(searchStrategy);
    updatedSearch["PlacementTypes"] = nextPlacements;

    const updateRes = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v501/campaigns",
      method: "POST",
      body: {
        method: "update",
        params: {
          Campaigns: [
            {
              Id: campaign["Id"],
              UnifiedCampaign: {
                BiddingStrategy: {
                  Search: updatedSearch,
                },
              },
            },
          ],
        },
      },
      account: parsed.account,
      client_login: parsed.client_login,
    });

    if (!updateRes.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Campaigns.update failed", details: updateRes.body }, null, 2),
          },
        ],
      };
    }

    const updateData = updateRes.data as {
      result?: {
        UpdateResults?: Array<{ Id?: number; Errors?: Array<Record<string, unknown>> }>;
      };
      error?: unknown;
    };

    if (updateData?.error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Campaigns.update returned error", details: updateData.error }, null, 2),
          },
        ],
      };
    }

    const firstResult = updateData?.result?.UpdateResults?.[0];
    if (firstResult?.Errors && firstResult.Errors.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Campaigns.update reported errors", errors: firstResult.Errors }, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              ok: true,
              campaign_id: campaign["Id"],
              name: campaign["Name"],
              previous_placements: {
                search_results: currentPlacementTypes.SearchResults === "YES",
                maps: currentPlacementTypes.Maps === "YES",
                product_gallery: currentPlacementTypes.ProductGallery === "YES",
                dynamic_places: currentPlacementTypes.DynamicPlaces === "YES",
                search_organization_list: currentPlacementTypes.SearchOrganizationList === "YES",
              },
              updated_placements: {
                search_results: nextPlacements.SearchResults === "YES",
                maps: nextPlacements.Maps === "YES",
                product_gallery: nextPlacements.ProductGallery === "YES",
                dynamic_places: nextPlacements.DynamicPlaces === "YES",
                search_organization_list: nextPlacements.SearchOrganizationList === "YES",
              },
              raw_placement_types: nextPlacements,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
