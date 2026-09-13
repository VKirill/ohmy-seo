import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_create_campaign";

const CHANNELS = new Set(["SEARCH", "DISPLAY", "PERFORMANCE_MAX", "VIDEO", "DEMAND_GEN"]);
const GEO_TYPES = new Set(["PRESENCE_OR_INTEREST", "PRESENCE"]);
/** Channels for which Google requires (or accepts) network_settings on create. */
const NEEDS_NETWORKS = new Set(["SEARCH", "DISPLAY", "PERFORMANCE_MAX"]);

/**
 * Creates a campaign. Status is forced to PAUSED whatever the caller asks —
 * a new campaign never starts spending money on its own.
 *
 * network_settings is REQUIRED by Google for SEARCH campaigns; leaving it out
 * returns a bare REQUIRED error with no field name, which is unreadable. The
 * defaults here are deliberate: Google Search only, search partners and the
 * display network OFF, because a Search campaign silently extended into
 * Display is the classic way an account burns a budget on nothing.
 */
export async function runAdsCreateCampaign(args: {
  account?: string;
  customer_id: string;
  name: string;
  budget_id: string;
  channel_type?: string;
  bidding_strategy?: string;
  target_cpa?: number;
  target_roas?: number;
  cpc_ceiling?: number;
  search_partners?: boolean;
  display_network?: boolean;
  geo_target_type?: string;
  eu_political_advertising?: boolean;
  start_date?: string;
  end_date?: string;
  login_customer_id?: string;
  confirm?: boolean;
  validate_only?: boolean;
}): Promise<McpText> {
  const channel = (args.channel_type ?? "SEARCH").trim().toUpperCase();
  if (!CHANNELS.has(channel)) {
    return asText({ error: `channel_type must be one of ${[...CHANNELS].join(", ")}` }, true);
  }

  const geoType = (args.geo_target_type ?? "PRESENCE_OR_INTEREST").trim().toUpperCase();
  if (!GEO_TYPES.has(geoType)) {
    return asText({ error: `geo_target_type must be one of ${[...GEO_TYPES].join(", ")}` }, true);
  }

  const customerId = digitsOnly(args.customer_id);
  const budgetId = digitsOnly(args.budget_id);
  if (budgetId.length === 0) return asText({ error: "budget_id is required" }, true);

  const create: Record<string, unknown> = {
    name: args.name,
    status: "PAUSED",
    advertisingChannelType: channel,
    campaignBudget: `customers/${customerId}/campaignBudgets/${budgetId}`,
    // Required by Google since the EU political ads rules. Leaving it out
    // returns REQUIRED with trigger {int64Value: "5"} and no field name —
    // verified 05.09.2026 by probing campaigns:mutate with validateOnly.
    containsEuPoliticalAdvertising:
      args.eu_political_advertising === true
        ? "CONTAINS_EU_POLITICAL_ADVERTISING"
        : "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
  };

  let networks: Record<string, boolean> | undefined;
  if (channel === "SEARCH") {
    networks = {
      targetGoogleSearch: true,
      targetSearchNetwork: args.search_partners === true,
      targetContentNetwork: args.display_network === true,
      targetPartnerSearchNetwork: false,
    };
  } else if (channel === "DISPLAY") {
    networks = {
      targetGoogleSearch: false,
      targetSearchNetwork: false,
      targetContentNetwork: true,
      targetPartnerSearchNetwork: false,
    };
  } else if (channel === "PERFORMANCE_MAX") {
    networks = {
      targetGoogleSearch: true,
      targetSearchNetwork: true,
      targetContentNetwork: true,
      targetPartnerSearchNetwork: false,
    };
  }
  if (networks && NEEDS_NETWORKS.has(channel)) {
    create["networkSettings"] = networks;
    create["geoTargetTypeSetting"] = {
      positiveGeoTargetType: geoType,
      negativeGeoTargetType: "PRESENCE",
    };
  }

  const strategy = (args.bidding_strategy ?? "MAXIMIZE_CONVERSIONS").trim().toUpperCase();
  if (strategy === "TARGET_CPA") {
    if (!(args.target_cpa && args.target_cpa > 0)) {
      return asText({ error: "target_cpa is required for TARGET_CPA bidding" }, true);
    }
    create["targetCpa"] = { targetCpaMicros: String(Math.round(args.target_cpa * 1_000_000)) };
  } else if (strategy === "TARGET_ROAS") {
    if (!(args.target_roas && args.target_roas > 0)) {
      return asText({ error: "target_roas is required for TARGET_ROAS bidding" }, true);
    }
    create["targetRoas"] = { targetRoas: args.target_roas };
  } else if (strategy === "MAXIMIZE_CONVERSION_VALUE") {
    create["maximizeConversionValue"] = {};
  } else if (strategy === "MAXIMIZE_CLICKS" || strategy === "TARGET_SPEND") {
    const spend: Record<string, unknown> = {};
    if (args.cpc_ceiling && args.cpc_ceiling > 0) {
      spend["cpcBidCeilingMicros"] = String(Math.round(args.cpc_ceiling * 1_000_000));
    }
    create["targetSpend"] = spend;
  } else {
    create["maximizeConversions"] = {};
  }

  if (args.start_date) create["startDate"] = args.start_date.replace(/-/g, "");
  if (args.end_date) create["endDate"] = args.end_date.replace(/-/g, "");

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: "campaigns:mutate",
    operations: [{ create }],
    target: { customer_id: customerId, name: args.name },
    change: {
      status: "PAUSED (forced)",
      channel_type: channel,
      bidding_strategy: strategy,
      ...(args.cpc_ceiling ? { cpc_ceiling: args.cpc_ceiling } : {}),
      ...(create["networkSettings"] ? { networks, geo_target_type: geoType } : {}),
    },
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.validate_only !== undefined ? { validate_only: args.validate_only } : {}),
  });
}
