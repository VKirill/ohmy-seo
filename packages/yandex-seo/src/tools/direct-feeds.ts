import { z } from "zod";
import { executeApiCall } from "../lib/api-gateway.js";
import { requireConfirmGate, ConfirmGateError } from "../lib/api/confirm-gate.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

// Product feeds (товарные фиды) — /json/v5/feeds. mode: add | get | update | delete.
// A feed sources products from a URL or an uploaded file; Yandex processes and
// moderates it — the result is visible in the `Status` field on get.
// Feeds feed dynamic ads / smart campaigns / ЕПК product galleries.
const InputSchema = z.object({
  mode: z.enum(["add", "get", "update", "delete"]).describe("add=create a feed, get=read (read-only), update=change, delete=remove"),

  // ---- add / update ----
  name: z.string().min(1).optional().describe("Feed name (add; optional rename on update)"),
  business_type: z
    .string()
    .optional()
    .describe("add: business vertical, e.g. RETAIL, AUTO, AUTO_PARTS, REALTY, HOTELS, FLIGHTS, OTHER (BusinessType). Required on add."),
  source: z
    .object({
      url: z.string().url().optional().describe("URL of the feed file (SourceType URL)"),
      remove_utm: z.enum(["YES", "NO"]).optional().describe("UrlFeed.RemoveUtmFromLandingUrl"),
      login: z.string().optional().describe("Basic-auth login for a protected feed URL"),
      password: z.string().optional().describe("Basic-auth password for a protected feed URL"),
      file_base64: z.string().optional().describe("Base64 feed file contents (SourceType FILE)"),
      filename: z.string().optional().describe("File name for a FILE feed"),
    })
    .optional()
    .describe("Feed source: pass `url` for a URL feed, or `file_base64`+`filename` for a file feed"),
  feed_id: z.union([z.number(), z.string()]).optional().describe("update/single-get: the feed Id to target"),

  // ---- get ----
  ids: z.array(z.union([z.number(), z.string()])).optional().describe("get: filter to these feed Ids (omit to list all)"),

  // ---- delete ----
  delete_ids: z.array(z.union([z.number(), z.string()])).optional().describe("delete: feed Ids to remove"),

  confirm: z.boolean().optional().describe("Required true for add/update/delete"),
  acknowledge_live: z.string().optional().describe("delete only — exact ack I-UNDERSTAND-FEED-DELETE:<account_or_default>:<sorted_ids_csv>"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().min(1).optional().describe("Agency client login (Client-Login header) for sub-client cabinets"),
});

type Input = z.infer<typeof InputSchema>;

const GET_FIELDS = ["Id", "Name", "BusinessType", "SourceType", "UpdatedAt", "CampaignIds", "NumberOfItems", "NumberOfListings", "Status"];

function buildSource(s: NonNullable<Input["source"]>): Record<string, unknown> {
  if (s.url) {
    return {
      SourceType: "URL",
      UrlFeed: {
        Url: s.url,
        ...(s.remove_utm ? { RemoveUtmFromLandingUrl: s.remove_utm } : {}),
        ...(s.login ? { Login: s.login } : {}),
        ...(s.password ? { Password: s.password } : {}),
      },
    };
  }
  if (s.file_base64) {
    return {
      SourceType: "FILE",
      FileFeed: { Filename: s.filename ?? "feed.xml", Data: s.file_base64 },
    };
  }
  throw new Error("source requires either `url` or `file_base64`+`filename`");
}

export async function runDirectFeeds(input: Input) {
  const parsed = InputSchema.parse(input);

  try {
    // ---- READ-ONLY: get ----
    if (parsed.mode === "get") {
      const ids = parsed.ids ?? (parsed.feed_id !== undefined ? [parsed.feed_id] : undefined);
      // Feeds.get quirk: an EMPTY SelectionCriteria errors "Omitted required parameter Ids";
      // to list all feeds you must OMIT SelectionCriteria entirely. Only include it with Ids.
      const params: Record<string, unknown> = { FieldNames: GET_FIELDS };
      if (ids && ids.length) params["SelectionCriteria"] = { Ids: ids };
      const result = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/feeds",
        method: "POST",
        body: { method: "get", params },
        account: parsed.account,
        client_login: parsed.client_login,
      });
      if (!result.ok) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "feeds.get failed", details: result.body }) }] };
      const apiErr = (result.data as { error?: unknown })?.error;
      if (apiErr) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "feeds.get failed", details: apiErr }) }] };
      const feeds = ((result.data as { result?: { Feeds?: unknown[] } })?.result?.Feeds) ?? [];
      return { content: [{ type: "text" as const, text: JSON.stringify({ mode: "get", count: feeds.length, feeds }, null, 2) }] };
    }

    // ---- MUTATIONS: gate ----
    const accountLabel = parsed.account ?? "default";
    const isDelete = parsed.mode === "delete";
    const sortedIds = isDelete ? [...(parsed.delete_ids ?? [])].map(String).sort().join(",") : "";
    const expectedAck = `I-UNDERSTAND-FEED-DELETE:${accountLabel}:${sortedIds}`;
    try {
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
      if (!parsed.name) throw new Error("mode=add requires `name`");
      if (!parsed.business_type) throw new Error("mode=add requires `business_type`");
      if (!parsed.source) throw new Error("mode=add requires `source` (url or file_base64)");
      body = { method: "add", params: { Feeds: [{ Name: parsed.name, BusinessType: parsed.business_type, ...buildSource(parsed.source) }] } };
    } else if (parsed.mode === "update") {
      if (parsed.feed_id === undefined) throw new Error("mode=update requires `feed_id`");
      const feed: Record<string, unknown> = { Id: parsed.feed_id };
      if (parsed.name) feed["Name"] = parsed.name;
      if (parsed.source) Object.assign(feed, buildSource(parsed.source));
      body = { method: "update", params: { Feeds: [feed] } };
    } else {
      if (!parsed.delete_ids || parsed.delete_ids.length === 0) throw new Error("mode=delete requires `delete_ids`");
      body = { method: "delete", params: { SelectionCriteria: { Ids: parsed.delete_ids } } };
    }

    const result = await executeApiCall({ apiName: "direct", endpoint: "/json/v5/feeds", method: "POST", body, account: parsed.account, client_login: parsed.client_login });
    if (!result.ok) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `feeds.${parsed.mode} failed`, details: result.body }) }] };
    const apiErr = (result.data as { error?: unknown })?.error;
    if (apiErr) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `feeds.${parsed.mode} failed`, details: apiErr }) }] };

    const apiResult = (result.data as { result?: Record<string, unknown> })?.result ?? {};
    const opResults = (apiResult.AddResults ?? apiResult.UpdateResults ?? apiResult.DeleteResults) as Array<Record<string, unknown>> | undefined;
    const ids = (opResults ?? []).map((r) => r.Id).filter((x) => x !== undefined).map(String);
    const errors = (opResults ?? []).flatMap((r) => (r.Errors as unknown[]) ?? []);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ mode: parsed.mode, ok: errors.length === 0, feed_ids: ids, errors, result: apiResult }, null, 2) }],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
