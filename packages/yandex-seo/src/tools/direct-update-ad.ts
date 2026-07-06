import { z } from "zod";
import { executeApiCall } from "../lib/api-gateway.js";
import { buildResponsiveAdUpdatePayload } from "../lib/payload-builder.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

// Surgical point-edit of a combinatorial RESPONSIVE_AD via /json/v501/ads update.
// ad_id is a STRING — Yandex ad ids exceed 2^53; passing a rounded number → "Ad not found".
// Only provided ResponsiveAd fields change. DANGER-lite gate (env flags + confirm).
const InputSchema = z.object({
  ad_id: z.union([z.string().min(1), z.number()]).describe("Ad ID (pass as STRING to preserve the full big-int; number risks precision loss)"),
  titles: z.array(z.string().min(1).max(56)).min(1).max(7).optional().describe("Replace the headline pool (1–7 titles, ≤56 chars each)"),
  texts: z.array(z.string().min(1).max(81)).min(1).max(3).optional().describe("Replace the text pool (1–3 texts, ≤81 chars each)"),
  href: z.string().min(1).max(1024).optional().describe("Replace the target URL"),
  image_hashes: z.array(z.string().min(1)).max(5).optional().describe("Replace image set (1–5 AdImageHashes)"),
  video_extension_ids: z.array(z.number().int().positive()).min(1).max(6).optional().describe("Replace video extensions (1–6 IDs)"),
  sitelinks_set_id: z.number().int().positive().optional().describe("Replace sitelinks set ID"),
  ad_extensions: z.array(z.number().int().positive()).max(50).optional().describe("Replace callout extension IDs (≤50)"),
  business_id: z.number().int().positive().optional().describe("Replace attached Yandex.Business organization ID"),
  confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().min(1).optional().describe("Agency client login (Client-Login header) for sub-client cabinets"),
});

type Input = z.infer<typeof InputSchema>;

const EDITABLE_KEYS = ["titles", "texts", "href", "image_hashes", "video_extension_ids", "sitelinks_set_id", "ad_extensions", "business_id"] as const;

export async function runDirectUpdateAd(input: Input) {
  const parsed = InputSchema.parse(input);

  if (process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS !== "true") throw new Error("OHMY_SEO_ALLOW_LIVE_MUTATIONS=true required");
  if (process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS !== "true") throw new Error("YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true required");
  if (parsed.confirm !== true) throw new Error("confirm: true required");

  const provided = EDITABLE_KEYS.filter((k) => parsed[k] !== undefined);
  if (provided.length === 0) throw new Error("no editable fields provided — pass at least one of: " + EDITABLE_KEYS.join(", "));

  try {
    const body = buildResponsiveAdUpdatePayload({
      ad_id: String(parsed.ad_id), // always send as string — big-int safe
      Titles: parsed.titles,
      Texts: parsed.texts,
      Href: parsed.href,
      AdImageHashes: parsed.image_hashes,
      VideoExtensionIds: parsed.video_extension_ids,
      SitelinkSetId: parsed.sitelinks_set_id,
      AdExtensionIds: parsed.ad_extensions,
      BusinessId: parsed.business_id,
    });

    const result = await executeApiCall({ apiName: "direct", endpoint: "/json/v501/ads", method: "POST", body, account: parsed.account, client_login: parsed.client_login });
    if (!result.ok) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Ads.update failed", details: result.body }) }] };
    const apiErr = (result.data as { error?: unknown })?.error;
    if (apiErr) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Ads.update failed", details: apiErr }) }] };

    const upd = (result.data as { result?: { UpdateResults?: Array<Record<string, unknown>> } })?.result?.UpdateResults ?? [];
    const errors = upd.flatMap((r) => (r.Errors as unknown[]) ?? []);
    const warnings = upd.flatMap((r) => (r.Warnings as unknown[]) ?? []);
    return { content: [{ type: "text" as const, text: JSON.stringify({ updated: errors.length === 0, ad_id: String(parsed.ad_id), fields: provided, errors, warnings, result: result.data }, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
