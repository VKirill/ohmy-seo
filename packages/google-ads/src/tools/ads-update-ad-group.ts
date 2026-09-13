import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_update_ad_group";

const ALLOWED_STATUS = new Set(["ENABLED", "PAUSED"]);

/**
 * Renames an ad group and, optionally, changes its status or default bid.
 *
 * Not a DANGER tool: a rename cannot spend money, and an ad group inside a
 * paused campaign cannot serve whatever its own status says. REMOVED is not
 * accepted here — deleting is a separate, irreversible decision.
 *
 * Only the fields you pass end up in updateMask, so a rename never silently
 * resets a bid someone tuned by hand.
 */
export async function runAdsUpdateAdGroup(args: {
  account?: string;
  customer_id: string;
  ad_group_id: string;
  name?: string;
  status?: string;
  cpc_bid?: number;
  login_customer_id?: string;
  confirm?: boolean;
  validate_only?: boolean;
}): Promise<McpText> {
  const customerId = digitsOnly(args.customer_id);
  const adGroupId = digitsOnly(args.ad_group_id);
  if (adGroupId.length === 0) return asText({ error: "ad_group_id is required" }, true);

  const update: Record<string, unknown> = {
    resourceName: "customers/" + customerId + "/adGroups/" + adGroupId,
  };
  const maskPaths: string[] = [];
  const change: Record<string, unknown> = {};

  const name = (args.name ?? "").trim();
  if (name !== "") {
    if (name.length > 255) return asText({ error: "name длиннее 255 символов" }, true);
    update["name"] = name;
    maskPaths.push("name");
    change["name"] = name;
  }

  if (args.status !== undefined && args.status !== "") {
    const status = args.status.trim().toUpperCase();
    if (!ALLOWED_STATUS.has(status)) {
      return asText(
        { error: "status должен быть ENABLED или PAUSED. Для удаления есть отдельные инструменты." },
        true,
      );
    }
    update["status"] = status;
    maskPaths.push("status");
    change["status"] = status;
  }

  if (args.cpc_bid !== undefined) {
    if (!(args.cpc_bid > 0)) return asText({ error: "cpc_bid должен быть больше нуля" }, true);
    const micros = Math.round(args.cpc_bid * 1_000_000);
    update["cpcBidMicros"] = String(micros);
    maskPaths.push("cpc_bid_micros");
    change["cpc_bid"] = args.cpc_bid;
  }

  if (maskPaths.length === 0) {
    return asText({ error: "Нечего менять: передайте name, status или cpc_bid" }, true);
  }

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: "adGroups:mutate",
    operations: [{ update, updateMask: maskPaths.join(",") }],
    target: { customer_id: customerId, ad_group_id: adGroupId },
    change,
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.validate_only !== undefined ? { validate_only: args.validate_only } : {}),
  });
}
