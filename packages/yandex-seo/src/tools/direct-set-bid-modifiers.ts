import { z } from "zod";
import { executeApiCall } from "../lib/api-gateway.js";
import {
  buildBidModifierAddPayload,
  buildBidModifierSetPayload,
  buildBidModifierDeletePayload,
  buildBidModifierGetPayload,
  buildBidModifierAdjustment,
} from "../lib/payload-builder.js";
import { requireConfirmGate, ConfirmGateError } from "../lib/api/confirm-gate.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

// Bid modifiers (корректировки ставок) — /json/v5/bidmodifiers.
// One tool, four modes: add | set | delete | get.
//   ЕПК (UnifiedCampaign) verified-supported types: mobile, desktop, desktop_only, video.
//   demographics / regional / retargeting are rejected as "unknown parameter" on ЕПК but
//   remain valid for classic campaign types — the tool passes them through; the API decides.
//   add → returns Ids arrays; there is no toggle/Enabled — coefficients change via set.

const AdjustmentSpec = z
  .object({
    campaign_id: z.number().int().positive().optional().describe("Scope to a campaign (mutually exclusive with ad_group_id)"),
    ad_group_id: z.number().int().positive().optional().describe("Scope to an ad group (mutually exclusive with campaign_id)"),
    type: z
      .enum(["mobile", "desktop", "desktop_only", "video", "demographics", "regional", "retargeting", "raw"])
      .describe("Adjustment type. ЕПК supports mobile/desktop/desktop_only/video; the rest apply to classic campaigns."),
    bid_modifier: z
      .number()
      .int()
      .min(0)
      .max(1300)
      .optional()
      .describe("Bid coefficient (percent). 100 = no change; e.g. 50 = −50%, 130 = +30%. 0 disables mobile/desktop where allowed."),
    operating_system_type: z.enum(["ANDROID", "IOS"]).optional().describe("mobile only: restrict to an OS (optional)"),
    age: z.enum(["AGE_0_17", "AGE_18_24", "AGE_25_34", "AGE_35_44", "AGE_45_54", "AGE_55"]).optional().describe("demographics only"),
    gender: z.enum(["GENDER_MALE", "GENDER_FEMALE"]).optional().describe("demographics only"),
    region_id: z.number().int().optional().describe("regional only: region ID (must be within the campaign's geo)"),
    retargeting_condition_id: z.number().int().optional().describe("retargeting only: retargeting condition ID"),
    raw_adjustment: z.record(z.string(), z.unknown()).optional().describe("type='raw': the full adjustment object verbatim, e.g. { WeatherAdjustment: {...} }"),
  })
  .describe("One adjustment scoped to exactly one campaign_id or ad_group_id");

const InputSchema = z.object({
  mode: z.enum(["add", "set", "delete", "get"]).describe("add=create adjustments, set=change coefficients, delete=remove, get=read (read-only)"),
  adjustments: z.array(AdjustmentSpec).optional().describe("mode=add: adjustments to create"),
  updates: z
    .array(z.object({ id: z.union([z.number(), z.string()]), bid_modifier: z.number().int().min(0).max(1300) }))
    .optional()
    .describe("mode=set: [{ id, bid_modifier }] — change the coefficient of existing modifiers"),
  ids: z.array(z.union([z.number(), z.string()])).optional().describe("mode=delete: modifier IDs to remove; mode=get: filter by modifier IDs"),
  campaign_ids: z.array(z.union([z.number(), z.string()])).optional().describe("mode=get: read modifiers for these campaigns"),
  ad_group_ids: z.array(z.union([z.number(), z.string()])).optional().describe("mode=get: read modifiers for these ad groups"),
  types: z.array(z.enum(["MOBILE", "DESKTOP", "DESKTOP_ONLY", "VIDEO", "DEMOGRAPHICS", "REGIONAL", "RETARGETING"])).optional().describe("mode=get: which adjustment types' values to return (default: ЕПК set MOBILE/DESKTOP/DESKTOP_ONLY/VIDEO)"),
  confirm: z.boolean().optional().describe("Required true for add/set/delete"),
  acknowledge_live: z.string().optional().describe("mode=delete only — exact ack: I-UNDERSTAND-BIDMOD-DELETE:<account_or_default>:<sorted_ids_csv>"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().min(1).optional().describe("Agency client login (Client-Login header) for sub-client cabinets"),
});

type Input = z.infer<typeof InputSchema>;

export async function runDirectSetBidModifiers(input: Input) {
  const parsed = InputSchema.parse(input);

  try {
    // ---- READ-ONLY: get ----
    if (parsed.mode === "get") {
      const body = buildBidModifierGetPayload({
        campaign_ids: parsed.campaign_ids,
        ad_group_ids: parsed.ad_group_ids,
        ids: parsed.ids,
        types: parsed.types,
      });
      const result = await executeApiCall({ apiName: "direct", endpoint: "/json/v5/bidmodifiers", method: "POST", body, account: parsed.account, client_login: parsed.client_login });
      if (!result.ok) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "bidmodifiers.get failed", details: result.body }) }] };
      const getErr = (result.data as { error?: unknown })?.error;
      if (getErr) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "bidmodifiers.get failed", details: getErr }) }] };
      const modifiers = ((result.data as { result?: { BidModifiers?: unknown[] } })?.result?.BidModifiers) ?? [];
      return { content: [{ type: "text" as const, text: JSON.stringify({ mode: "get", count: modifiers.length, modifiers }, null, 2) }] };
    }

    // ---- MUTATIONS: gate ----
    const accountLabel = parsed.account ?? "default";
    const isDelete = parsed.mode === "delete";
    const sortedIds = isDelete ? [...(parsed.ids ?? [])].map(String).sort().join(",") : "";
    const expectedAck = `I-UNDERSTAND-BIDMOD-DELETE:${accountLabel}:${sortedIds}`;
    try {
      // delete carries an exact ack; add/set are DANGER-lite (env flags + confirm).
      requireConfirmGate(
        { confirm: parsed.confirm, acknowledge_live: isDelete ? parsed.acknowledge_live : "" },
        { expectedAck: isDelete ? expectedAck : "" },
      );
    } catch (err) {
      if (err instanceof ConfirmGateError) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: err.code, message: err.message, ...(isDelete ? { expected_ack: expectedAck } : {}) }) }] };
      }
      throw err;
    }

    let body: unknown;
    if (parsed.mode === "add") {
      if (!parsed.adjustments || parsed.adjustments.length === 0) throw new Error("mode=add requires a non-empty adjustments array");
      for (const a of parsed.adjustments) {
        if ((a.campaign_id === undefined) === (a.ad_group_id === undefined)) {
          throw new Error("each adjustment needs exactly one of campaign_id or ad_group_id");
        }
      }
      body = buildBidModifierAddPayload(parsed.adjustments.map((a) => buildBidModifierAdjustment(a)));
    } else if (parsed.mode === "set") {
      if (!parsed.updates || parsed.updates.length === 0) throw new Error("mode=set requires a non-empty updates array");
      body = buildBidModifierSetPayload(parsed.updates.map((u) => ({ Id: u.id, BidModifier: u.bid_modifier })));
    } else {
      if (!parsed.ids || parsed.ids.length === 0) throw new Error("mode=delete requires a non-empty ids array");
      body = buildBidModifierDeletePayload(parsed.ids);
    }

    const result = await executeApiCall({ apiName: "direct", endpoint: "/json/v5/bidmodifiers", method: "POST", body, account: parsed.account, client_login: parsed.client_login });
    if (!result.ok) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `bidmodifiers.${parsed.mode} failed`, details: result.body }) }] };
    const apiErr = (result.data as { error?: unknown })?.error;
    if (apiErr) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `bidmodifiers.${parsed.mode} failed`, details: apiErr }) }] };

    const apiResult = (result.data as { result?: Record<string, unknown> })?.result ?? {};
    // add → AddResults[].Ids (array of strings). set/delete → SetResults/DeleteResults[].Id.
    const opResults = (apiResult.AddResults ?? apiResult.SetResults ?? apiResult.DeleteResults) as Array<Record<string, unknown>> | undefined;
    const createdIds = parsed.mode === "add" ? (opResults ?? []).flatMap((r) => (r.Ids as unknown[]) ?? []).map(String) : undefined;
    const errors = (opResults ?? []).flatMap((r) => (r.Errors as unknown[]) ?? []);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ mode: parsed.mode, ok: errors.length === 0, ...(createdIds ? { created_ids: createdIds } : {}), errors, result: apiResult }, null, 2),
      }],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
