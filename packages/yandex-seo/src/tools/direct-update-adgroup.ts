import { z } from "zod";
import { executeApiCall } from "../lib/api-gateway.js";
import { buildAdGroupUpdatePayload } from "../lib/payload-builder.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

// Surgical point-edit of a ЕПК ad group via /json/v501/adgroups update.
// Only provided fields change. DANGER-lite gate (env flags + confirm).
const InputSchema = z.object({
  ad_group_id: z.number().int().positive().describe("Ad group ID to edit"),
  name: z.string().min(1).optional().describe("New ad group name"),
  region_ids: z.array(z.number().int()).min(1).optional().describe("New target region IDs (REPLACES the geo list)"),
  negative_keywords: z.array(z.string().min(1)).optional().describe("Ad group-level negative keywords. REPLACES the set (pass [] to clear)."),
  tracking_params: z.string().optional().describe("UTM / tracking params string"),
  raw_fields: z.record(z.string(), z.unknown()).optional().describe("Escape hatch: extra fields merged verbatim at the AdGroup level"),
  confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().min(1).optional().describe("Agency client login (Client-Login header) for sub-client cabinets"),
});

type Input = z.infer<typeof InputSchema>;

const EDITABLE_KEYS = ["name", "region_ids", "negative_keywords", "tracking_params", "raw_fields"] as const;

export async function runDirectUpdateAdGroup(input: Input) {
  const parsed = InputSchema.parse(input);

  if (process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS !== "true") throw new Error("OHMY_SEO_ALLOW_LIVE_MUTATIONS=true required");
  if (process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS !== "true") throw new Error("YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true required");
  if (parsed.confirm !== true) throw new Error("confirm: true required");

  const provided = EDITABLE_KEYS.filter((k) => parsed[k] !== undefined);
  if (provided.length === 0) throw new Error("no editable fields provided — pass at least one of: " + EDITABLE_KEYS.join(", "));

  try {
    const body = buildAdGroupUpdatePayload({
      ad_group_id: parsed.ad_group_id,
      name: parsed.name,
      region_ids: parsed.region_ids,
      negative_keywords: parsed.negative_keywords,
      tracking_params: parsed.tracking_params,
      raw_fields: parsed.raw_fields,
    });

    const result = await executeApiCall({ apiName: "direct", endpoint: "/json/v501/adgroups", method: "POST", body, account: parsed.account, client_login: parsed.client_login });
    if (!result.ok) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "AdGroups.update failed", details: result.body }) }] };
    const apiErr = (result.data as { error?: unknown })?.error;
    if (apiErr) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "AdGroups.update failed", details: apiErr }) }] };

    const upd = (result.data as { result?: { UpdateResults?: Array<Record<string, unknown>> } })?.result?.UpdateResults ?? [];
    const errors = upd.flatMap((r) => (r.Errors as unknown[]) ?? []);
    const warnings = upd.flatMap((r) => (r.Warnings as unknown[]) ?? []);
    return { content: [{ type: "text" as const, text: JSON.stringify({ updated: errors.length === 0, ad_group_id: parsed.ad_group_id, fields: provided, errors, warnings, result: result.data }, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
