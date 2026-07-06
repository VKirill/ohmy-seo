import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

// Campaign- and ad-group-level negative keywords (минус-фразы), as a dedicated tool.
// mode:
//   replace (default) — overwrite NegativeKeywords.Items with the given list
//   append            — read the current set, merge + dedupe, then write back
//   get               — read-only: return the current negative keywords
// replace/append use the DANGER-lite gate (env flags + confirm); get needs neither.
const InputSchema = z.object({
  target: z
    .union([
      z.object({ campaign_id: z.number().int().positive() }),
      z.object({ ad_group_id: z.number().int().positive() }),
    ])
    .describe("Target: either { campaign_id } or { ad_group_id } — mutually exclusive"),
  mode: z.enum(["replace", "append", "get"]).default("replace").describe("replace=overwrite, append=merge with existing, get=read-only"),
  keywords: z.array(z.string().min(1)).optional().describe("Negative keywords (minus-words). Required for replace/append; ignored for get."),
  confirm: z.boolean().optional().describe("Must be true for replace/append"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().min(1).optional().describe("Agency client login (Client-Login header) for sub-client cabinets"),
});

type NegativeKeywordsInput = z.infer<typeof InputSchema>;

const isCampaign = (t: NegativeKeywordsInput["target"]): t is { campaign_id: number } => "campaign_id" in t;

async function readExisting(parsed: NegativeKeywordsInput): Promise<string[]> {
  if (isCampaign(parsed.target)) {
    const r = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/campaigns",
      method: "POST",
      body: { method: "get", params: { SelectionCriteria: { Ids: [parsed.target.campaign_id] }, FieldNames: ["Id", "NegativeKeywords"] } },
      account: parsed.account,
      client_login: parsed.client_login,
    });
    if (!r.ok) throw new Error(`Campaigns.get failed: ${JSON.stringify(r.body)}`);
    return (r.data as { result?: { Campaigns?: Array<{ NegativeKeywords?: { Items?: string[] } }> } })?.result?.Campaigns?.[0]?.NegativeKeywords?.Items ?? [];
  }
  const r = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/adgroups",
    method: "POST",
    body: { method: "get", params: { SelectionCriteria: { Ids: [parsed.target.ad_group_id] }, FieldNames: ["Id", "NegativeKeywords"] } },
    account: parsed.account,
    client_login: parsed.client_login,
  });
  if (!r.ok) throw new Error(`AdGroups.get failed: ${JSON.stringify(r.body)}`);
  return (r.data as { result?: { AdGroups?: Array<{ NegativeKeywords?: { Items?: string[] } }> } })?.result?.AdGroups?.[0]?.NegativeKeywords?.Items ?? [];
}

async function writeSet(parsed: NegativeKeywordsInput, items: string[]) {
  if (isCampaign(parsed.target)) {
    return executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/campaigns",
      method: "POST",
      body: { method: "update", params: { Campaigns: [{ Id: parsed.target.campaign_id, NegativeKeywords: { Items: items } }] } },
      account: parsed.account,
      client_login: parsed.client_login,
    });
  }
  return executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/adgroups",
    method: "POST",
    body: { method: "update", params: { AdGroups: [{ Id: parsed.target.ad_group_id, NegativeKeywords: { Items: items } }] } },
    account: parsed.account,
    client_login: parsed.client_login,
  });
}

export async function runDirectNegativeKeywordsAdd(input: NegativeKeywordsInput) {
  const parsed = InputSchema.parse(input);
  const level = isCampaign(parsed.target) ? "campaign" : "ad_group";
  const targetId = isCampaign(parsed.target) ? parsed.target.campaign_id : parsed.target.ad_group_id;

  try {
    // ---- read-only ----
    if (parsed.mode === "get") {
      const existing = await readExisting(parsed);
      return { content: [{ type: "text" as const, text: JSON.stringify({ mode: "get", level, [`${level}_id`]: targetId, count: existing.length, keywords: existing }, null, 2) }] };
    }

    // ---- mutations: DANGER-lite gate ----
    if (process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS !== "true") throw new Error("OHMY_SEO_ALLOW_LIVE_MUTATIONS=true required");
    if (process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS !== "true") throw new Error("YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true required");
    if (parsed.confirm !== true) throw new Error("confirm: true required");
    if (!parsed.keywords || parsed.keywords.length === 0) throw new Error(`mode=${parsed.mode} requires a non-empty keywords array`);

    let items = parsed.keywords;
    if (parsed.mode === "append") {
      const existing = await readExisting(parsed);
      items = Array.from(new Set([...existing, ...parsed.keywords]));
    }

    const result = await writeSet(parsed, items);
    if (!result.ok) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: `NegativeKeywords ${parsed.mode} failed`, level, details: result.body }) }] };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ mode: parsed.mode, level, [`${level}_id`]: targetId, total_keywords: items.length, keywords: items, result: result.data }, null, 2),
      }],
    };
  } catch (err) {
    return errorToMcpContent(err);
  }
}
