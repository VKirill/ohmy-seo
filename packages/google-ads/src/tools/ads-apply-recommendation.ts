import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_ADWORDS } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { digitsOnly, enrichMicros, executeAdsCall } from "../lib/ads-client.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { buildDryRunPreview } from "../lib/confirm-gate.js";

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
}): Promise<McpText> {
  try {
    const customerId = digitsOnly(args.customer_id);
    const resourceName = (args.resource_name ?? "").trim();
    if (!resourceName.includes("recommendations/")) {
      return asText(
        { error: "resource_name must look like customers/<id>/recommendations/<id>" },
        true,
      );
    }

    if (args.confirm !== true) {
      return asText(
        buildDryRunPreview(
          TOOL_NAME,
          { customer_id: customerId, resource_name: resourceName },
          { action: "apply recommendation" },
        ),
      );
    }

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
