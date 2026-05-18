/**
 * xmlstock-yandex-serp.ts — MCP tool: fetch + cache Yandex SERP via XMLStock.
 */

import { z } from "zod";
import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { fetchYandexSerp } from "../lib/xmlstock-client.js";
import { parseYandexSerpXml } from "../lib/xmlstock-parse.js";
import { incrementUsage } from "../lib/usage-counter.js";

// ---------------------------------------------------------------------------
// Cache registration
// ---------------------------------------------------------------------------

registerCacheableTool("xmlstock_yandex_serp", {
  ttlEnvKey: "MCP_XMLSTOCK_CACHE_TTL_SERP",
  ttlDefaultSeconds: 86_400,
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const xmlstockYandexSerpInputSchema = z.object({
  query:         z.string().min(1),
  lr:            z.number().optional(),
  domain:        z.enum(["ru", "by", "kz", "com"]).optional(),
  device:        z.enum(["desktop", "mobile"]).optional(),
  page:          z.number().int().min(0).max(2).optional(),
  groupby:       z.union([z.literal(10), z.literal(50), z.literal(100)]).optional(),
  force_refresh: z.boolean().default(false),
});

export type XmlstockYandexSerpInput = z.infer<typeof xmlstockYandexSerpInputSchema>;

export const xmlstockYandexSerpDescription =
  "Fetch Yandex SERP for a query via XMLStock. Results are cached 24 h by default.";

// ---------------------------------------------------------------------------
// Canonical args (for stable cache key — strip optional fields that equal defaults)
// ---------------------------------------------------------------------------

function canonicalArgs(args: XmlstockYandexSerpInput): Record<string, unknown> {
  return {
    query:   args.query.trim().toLowerCase(),
    domain:  args.domain  ?? "ru",
    device:  args.device  ?? "desktop",
    page:    args.page    ?? 0,
    groupby: args.groupby ?? 10,
    ...(args.lr !== undefined && { lr: args.lr }),
  };
}

// ---------------------------------------------------------------------------
// Tool runner
// ---------------------------------------------------------------------------

export async function runXmlstockYandexSerp(args: XmlstockYandexSerpInput) {
  const canonical = canonicalArgs(args);
  const user = process.env.XMLSTOCK_USER ?? "";
  const key  = process.env.XMLSTOCK_KEY  ?? "";

  const payload = await withCache(
    {
      toolName:     "xmlstock_yandex_serp",
      accountId:    null,
      args:         canonical,
      forceRefresh: args.force_refresh,
      skipCacheIf:  (r: unknown) => (r as { isError?: boolean }).isError === true,
    },
    async () => {
      const r = await fetchYandexSerp({
        user, key,
        query:   canonical.query as string,
        domain:  canonical.domain as string,
        device:  canonical.device as string,
        page:    canonical.page as number,
        groupby: String(canonical.groupby),
        ...(canonical.lr !== undefined && { lr: canonical.lr as number }),
      });

      if (!r.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(r.error) }],
        };
      }

      const parsed = parseYandexSerpXml(r.xml);
      incrementUsage("xmlstock_yandex_serp", "yandex");
      const now = Date.now();
      return {
        engine:            "yandex" as const,
        query:             args.query,
        results:           parsed.results,
        totalfound:        parsed.totalfound,
        fetched_at:        new Date(now).toISOString(),
        cache_age_seconds: 0,
        expires_at:        new Date(now + 86_400_000).toISOString(),
        cached:            false,
      };
    },
  );

  if ((payload as { isError?: boolean }).isError) return payload;
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
