import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_create_ad";

const MAX_HEADLINE = 30;
const MAX_DESCRIPTION = 90;
const MAX_PATH = 15;

const PINNED_HEADLINE = new Set(["HEADLINE_1", "HEADLINE_2", "HEADLINE_3"]);
const PINNED_DESCRIPTION = new Set(["DESCRIPTION_1", "DESCRIPTION_2"]);

export interface AdAsset {
  text: string;
  /** HEADLINE_1..3 for headlines, DESCRIPTION_1..2 for descriptions. */
  pinned?: string;
}

/**
 * Google counts CHARACTERS, and JS .length counts UTF-16 code units. For
 * Cyrillic the two agree, but an emoji would be counted twice — so spread
 * into code points and count those.
 */
function charCount(text: string): number {
  return [...text].length;
}

/**
 * Validates one asset list before anything reaches Google. Worth doing here:
 * the API answers a too-long headline with a generic policy error that says
 * nothing about which line broke it.
 */
function normalizeAssets(
  items: Array<AdAsset | string>,
  limit: number,
  allowedPins: Set<string>,
  label: string,
): { assets: Array<Record<string, unknown>>; problems: string[] } {
  const assets: Array<Record<string, unknown>> = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  items.forEach((raw, i) => {
    const item: AdAsset = typeof raw === "string" ? { text: raw } : raw;
    const text = (item.text ?? "").trim();
    const position = label + " " + String(i + 1);

    if (text.length === 0) {
      problems.push(position + ": пустой текст");
      return;
    }

    const length = charCount(text);
    if (length > limit) {
      problems.push(position + ": " + String(length) + " символов при лимите " + String(limit) + " — «" + text + "»");
      return;
    }

    const key = text.toLowerCase();
    if (seen.has(key)) {
      problems.push(position + ": повтор — «" + text + "»");
      return;
    }
    seen.add(key);

    const asset: Record<string, unknown> = { text };
    if (item.pinned !== undefined && item.pinned !== "") {
      const pin = item.pinned.trim().toUpperCase();
      if (!allowedPins.has(pin)) {
        problems.push(
          position + ": недопустимое закрепление «" + item.pinned + "», допустимы " + [...allowedPins].join(", "),
        );
        return;
      }
      asset["pinnedField"] = pin;
    }
    assets.push(asset);
  });

  return { assets, problems };
}

/**
 * Creates a responsive search ad in an ad group. Paused by default — an ad in
 * a paused campaign cannot spend, and a new ad is usually worth a look before
 * it starts serving.
 *
 * Google's own minimums are enforced here rather than remotely: 3-15 headlines
 * of up to 30 characters, 2-4 descriptions of up to 90.
 */
export async function runAdsCreateAd(args: {
  account?: string;
  customer_id: string;
  ad_group_id: string;
  final_url: string;
  headlines: Array<AdAsset | string>;
  descriptions: Array<AdAsset | string>;
  path1?: string;
  path2?: string;
  enabled?: boolean;
  login_customer_id?: string;
  confirm?: boolean;
  validate_only?: boolean;
}): Promise<McpText> {
  const customerId = digitsOnly(args.customer_id);
  const adGroupId = digitsOnly(args.ad_group_id);
  if (adGroupId.length === 0) return asText({ error: "ad_group_id is required" }, true);

  const finalUrl = (args.final_url ?? "").trim();
  if (!/^https?:\/\//i.test(finalUrl)) {
    return asText({ error: "final_url должен начинаться с http:// или https://" }, true);
  }

  const head = normalizeAssets(args.headlines ?? [], MAX_HEADLINE, PINNED_HEADLINE, "Заголовок");
  const desc = normalizeAssets(args.descriptions ?? [], MAX_DESCRIPTION, PINNED_DESCRIPTION, "Описание");
  const problems = [...head.problems, ...desc.problems];

  if (head.assets.length < 3) {
    problems.push("Заголовков " + String(head.assets.length) + ", Google требует минимум 3");
  }
  if (head.assets.length > 15) {
    problems.push("Заголовков " + String(head.assets.length) + ", максимум 15");
  }
  if (desc.assets.length < 2) {
    problems.push("Описаний " + String(desc.assets.length) + ", Google требует минимум 2");
  }
  if (desc.assets.length > 4) {
    problems.push("Описаний " + String(desc.assets.length) + ", максимум 4");
  }

  const path1 = (args.path1 ?? "").trim();
  const path2 = (args.path2 ?? "").trim();
  if (path1 !== "" && charCount(path1) > MAX_PATH) {
    problems.push("path1: " + String(charCount(path1)) + " символов при лимите " + String(MAX_PATH));
  }
  if (path2 !== "" && charCount(path2) > MAX_PATH) {
    problems.push("path2: " + String(charCount(path2)) + " символов при лимите " + String(MAX_PATH));
  }
  if (path2 !== "" && path1 === "") {
    problems.push("path2 без path1 — Google отклонит объявление");
  }

  if (problems.length > 0) {
    return asText(
      {
        error: "Объявление не прошло проверку до отправки в Google",
        operation: TOOL_NAME,
        problems,
        limits: { headline: MAX_HEADLINE, description: MAX_DESCRIPTION, path: MAX_PATH },
      },
      true,
    );
  }

  const responsiveSearchAd: Record<string, unknown> = {
    headlines: head.assets,
    descriptions: desc.assets,
  };
  if (path1 !== "") responsiveSearchAd["path1"] = path1;
  if (path2 !== "") responsiveSearchAd["path2"] = path2;

  const status = args.enabled === true ? "ENABLED" : "PAUSED";
  const create = {
    adGroup: "customers/" + customerId + "/adGroups/" + adGroupId,
    status,
    ad: { finalUrls: [finalUrl], responsiveSearchAd },
  };

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: "adGroupAds:mutate",
    operations: [{ create }],
    target: { customer_id: customerId, ad_group_id: adGroupId },
    change: {
      status,
      headlines: head.assets.length,
      descriptions: desc.assets.length,
      final_url: finalUrl,
      ...(path1 !== "" ? { path1 } : {}),
      ...(path2 !== "" ? { path2 } : {}),
    },
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.validate_only !== undefined ? { validate_only: args.validate_only } : {}),
  });
}
