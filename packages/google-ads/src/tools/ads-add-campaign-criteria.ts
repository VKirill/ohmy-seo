import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_add_campaign_criteria";

/**
 * Adds location and language targeting to a campaign.
 *
 * These live in campaign_criterion, not on the campaign itself, which is why
 * ads_create_campaign cannot set them: a campaign is created first, then
 * targeted. Constant ids come from GAQL via ads_run_query, e.g.
 *   SELECT geo_target_constant.id, geo_target_constant.canonical_name
 *   FROM geo_target_constant WHERE geo_target_constant.name = 'Alanya'
 *   SELECT language_constant.id, language_constant.name, language_constant.code
 *   FROM language_constant WHERE language_constant.code = 'ru'
 *
 * Not DANGER: a campaign created by this package is always PAUSED, so widening
 * its targeting cannot start a spend on its own.
 */
export async function runAdsAddCampaignCriteria(args: {
  account?: string;
  customer_id: string;
  campaign_id: string;
  locations?: string[];
  negative_locations?: string[];
  languages?: string[];
  login_customer_id?: string;
  confirm?: boolean;
  validate_only?: boolean;
}): Promise<McpText> {
  const customerId = digitsOnly(args.customer_id);
  const campaignId = digitsOnly(args.campaign_id);
  if (campaignId.length === 0) return asText({ error: "campaign_id is required" }, true);

  const campaign = `customers/${customerId}/campaigns/${campaignId}`;
  const operations: object[] = [];
  const added: Record<string, string[]> = {};

  for (const raw of args.locations ?? []) {
    const id = digitsOnly(raw);
    if (id.length === 0) return asText({ error: `not a geo target constant id: ${raw}` }, true);
    operations.push({ create: { campaign, location: { geoTargetConstant: `geoTargetConstants/${id}` } } });
    (added["locations"] ??= []).push(id);
  }

  for (const raw of args.negative_locations ?? []) {
    const id = digitsOnly(raw);
    if (id.length === 0) return asText({ error: `not a geo target constant id: ${raw}` }, true);
    operations.push({
      create: { campaign, negative: true, location: { geoTargetConstant: `geoTargetConstants/${id}` } },
    });
    (added["negative_locations"] ??= []).push(id);
  }

  for (const raw of args.languages ?? []) {
    const id = digitsOnly(raw);
    if (id.length === 0) return asText({ error: `not a language constant id: ${raw}` }, true);
    operations.push({ create: { campaign, language: { languageConstant: `languageConstants/${id}` } } });
    (added["languages"] ??= []).push(id);
  }

  if (operations.length === 0) {
    return asText(
      { error: "nothing to add — pass locations, negative_locations or languages" },
      true,
    );
  }

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: "campaignCriteria:mutate",
    operations,
    target: { customer_id: customerId, campaign_id: campaignId },
    change: added,
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.validate_only !== undefined ? { validate_only: args.validate_only } : {}),
  });
}
