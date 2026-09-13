import { deleteWhere } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_ADWORDS } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "./account-resolver.js";
import {
  digitsOnly,
  enrichMicros,
  executeAdsCall,
  liveMutationsAllowed,
} from "./ads-client.js";
import { asText, type McpText } from "./ads-runner.js";
import { assertAcknowledgeLive, buildDryRunPreview } from "./confirm-gate.js";

const PKG_NAME = "google-ads";

/** Read tools whose cached answers go stale the moment anything is written. */
const READ_TOOLS = [
  "ads_list_accessible_customers",
  "ads_get_customer",
  "ads_list_campaigns",
  "ads_list_ad_groups",
  "ads_list_ads",
  "ads_list_keywords",
  "ads_list_negative_keywords",
  "ads_list_budgets",
  "ads_list_shared_sets",
  "ads_run_query",
  "ads_search_terms_report",
  "ads_keyword_performance_report",
  "ads_campaign_performance_report",
  "ads_change_history",
  "ads_recommendations",
];

export interface MutateArgs {
  /** Tool name, used for the preview payload only. */
  operation: string;
  account?: string;
  customerId: string;
  loginCustomerId?: string;
  /** Path after `customers/{id}/`, e.g. `campaigns:mutate`. */
  endpoint: string;
  operations: object[];
  /** Shown in the dry-run preview. */
  target: object;
  change: object;
  confirm?: boolean;
  /** DANGER tools additionally require the acknowledge_live echo. */
  danger?: boolean;
  acknowledge_live?: string;
  /** Resource part of the acknowledge token, e.g. `campaigns/123`. */
  resourceId?: string;
  /** Ask Google to validate without writing. */
  validate_only?: boolean;
}

/**
 * The single path every write goes through.
 *
 * confirm:false returns a preview and touches nothing. Every real write needs
 * GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true. DANGER writes additionally need an
 * acknowledge_live token that echoes both the customer and the resource.
 */
export async function runMutation(args: MutateArgs): Promise<McpText> {
  try {
    const customerId = digitsOnly(args.customerId);
    if (customerId.length === 0) return asText({ error: "customer_id is empty" }, true);

    if (args.confirm !== true) {
      const preview = buildDryRunPreview(args.operation, args.target, args.change);
      const hint = args.danger
        ? `Re-run with confirm:true and acknowledge_live:"I-UNDERSTAND-THIS-IS-LIVE:${customerId}:${args.resourceId ?? "<resource>"}"` +
          " (requires GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true)."
        : "Re-run with confirm:true to execute (requires GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true).";
      return asText({ ...preview, next_step: hint, operations: args.operations });
    }

    if (!args.validate_only && !liveMutationsAllowed()) {
      return asText(
        {
          error: "GOOGLE_ADS_ALLOW_LIVE_MUTATIONS is not true — live mutations are disabled.",
          how_to_enable:
            "Set GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true in packages/google-ads/.env and restart the server.",
          operation: args.operation,
        },
        true,
      );
    }

    if (args.danger) {
      assertAcknowledgeLive(
        { ...(args.acknowledge_live !== undefined ? { acknowledge_live: args.acknowledge_live } : {}) },
        `${customerId}:${args.resourceId ?? ""}`,
      );
    }

    const account = await resolveAccount(PKG_NAME, SCOPE_ADWORDS, args.account);

    const result = await executeAdsCall({
      account,
      method: "POST",
      path: `customers/${customerId}/${args.endpoint}`,
      body: {
        operations: args.operations,
        partialFailure: false,
        ...(args.validate_only ? { validateOnly: true } : {}),
      },
      ...(args.loginCustomerId !== undefined
        ? { loginCustomerId: digitsOnly(args.loginCustomerId) }
        : {}),
    });

    if (!result.ok) {
      return asText({ operation: args.operation, applied: false, error: result.data }, true);
    }

    if (!args.validate_only) invalidateReads(account.id);

    return asText({
      operation: args.operation,
      applied: !args.validate_only,
      validated_only: args.validate_only === true,
      target: args.target,
      change: args.change,
      response: enrichMicros(result.data),
      ...(result.login_customer_id ? { via_manager: result.login_customer_id } : {}),
    });
  } catch (e) {
    return errorToMcpContent(e) as McpText;
  }
}

/** Drops cached read answers for this account after a successful write. */
function invalidateReads(accountId: number): void {
  for (const tool of READ_TOOLS) {
    try {
      deleteWhere({ tool, account_id: accountId }, PKG_NAME);
    } catch {
      // cache invalidation must never break a successful mutation
    }
  }
}
