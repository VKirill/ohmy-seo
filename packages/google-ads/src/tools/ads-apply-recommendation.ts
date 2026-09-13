import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_ADWORDS } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import {
  digitsOnly,
  enrichMicros,
  executeAdsCall,
  liveMutationsAllowed,
} from "../lib/ads-client.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { assertAcknowledgeLive, buildDryRunPreview } from "../lib/confirm-gate.js";

const PKG_NAME = "google-ads";
export const TOOL_NAME = "ads_apply_recommendation";

/**
 * Applies one of Google's recommendations. Uses its own endpoint rather than
 * the shared mutate path, since :apply has a different request shape.
 */
export async function runAdsApplyRecommendation(args: {
  account?: string;
  customer_id: string;
  resource_name: string;
  login_customer_id?: string;
  confirm?: boolean;
  acknowledge_live?: string;
}): Promise<McpText> {
  try {
    const customerId = digitsOnly(args.customer_id);
    const resourceName = (args.resource_name ?? "").trim();
    const expectedPrefix = `customers/${customerId}/recommendations/`;
    if (!resourceName.startsWith(expectedPrefix)) {
      return asText(
        { error: `resource_name must start with ${expectedPrefix}` },
        true,
      );
    }
    const resourceId = resourceName.slice(`customers/${customerId}/`.length);

    if (args.confirm !== true) {
      const preview = buildDryRunPreview(
          TOOL_NAME,
          { customer_id: customerId, resource_name: resourceName },
          { action: "apply recommendation" },
        );
      return asText({
        ...preview,
        next_step:
          `Re-run with confirm:true and acknowledge_live:"I-UNDERSTAND-THIS-IS-LIVE:${customerId}:${resourceId}" ` +
          "(requires GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true).",
      });
    }

    if (!liveMutationsAllowed()) {
      return asText({
        error: "GOOGLE_ADS_ALLOW_LIVE_MUTATIONS is not true — live mutations are disabled.",
        operation: TOOL_NAME,
      }, true);
    }
    assertAcknowledgeLive(
      { ...(args.acknowledge_live ? { acknowledge_live: args.acknowledge_live } : {}) },
      `${customerId}:${resourceId}`,
    );

    const account = await resolveAccount(PKG_NAME, SCOPE_ADWORDS, args.account);
    const result = await executeAdsCall({
      account,
      method: "POST",
      path: `customers/${customerId}/recommendations:apply`,
      body: { operations: [{ resourceName }], partialFailure: false },
      ...(args.login_customer_id !== undefined
        ? { loginCustomerId: digitsOnly(args.login_customer_id) }
        : {}),
    });

    return asText(
      { operation: TOOL_NAME, applied: result.ok, response: enrichMicros(result.data) },
      !result.ok,
    );
  } catch (e) {
    return errorToMcpContent(e) as McpText;
  }
}
