/**
 * xmlstock-google-serp.ts — MCP tool: fetch + cache Google SERP via XMLStock.
 */

import { z } from "zod";
import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { fetchGoogleSerp } from "../lib/xmlstock-client.js";
import { parseGoogleSerpXml } from "../lib/xmlstock-parse.js";
import { incrementUsage } from "../lib/usage-counter.js";

// ---------------------------------------------------------------------------
// Cache registration
// ---------------------------------------------------------------------------

registerCacheableTool("xmlstock_google_serp", {
  ttlEnvKey: "MCP_XMLSTOCK_CACHE_TTL_SERP",
  ttlDefaultSeconds: 86_400,
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const xmlstockGoogleSerpInputSchema = z.object({
  query:         z.string().min(1),
  lr:            z.number().optional(),
  domain:        z.enum(["com", "ru", "com.ua", "143"]).optional(),
  device:        z.enum(["desktop", "mobile"]).optional(),
  page:          z.number().int().min(0).max(9).optional(),
  tbs:           z.string().optional(),
  hl:            z.string().optional(),
  force_refresh: z.boolean().default(false),
});

export type XmlstockGoogleSerpInput = z.infer<typeof xmlstockGoogleSerpInputSchema>;

export const xmlstockGoogleSerpDescription =
  "Fetch Google SERP for a query via XMLStock. Results are cached 24 h by default.";

// ---------------------------------------------------------------------------
// Canonical args (for stable cache key)
// ---------------------------------------------------------------------------

function canonicalArgs(args: XmlstockGoogleSerpInput): Record<string, unknown> {
  return {
    query:  args.query.trim().toLowerCase(),
    domain: args.domain ?? "com",
    device: args.device ?? "desktop",
    page:   args.page   ?? 0,
    ...(args.lr  !== undefined && { lr:  args.lr }),
    ...(args.tbs !== undefined && { tbs: args.tbs }),
    ...(args.hl  !== undefined && { hl:  args.hl }),
  };
}

// ---------------------------------------------------------------------------
// Tool runner
// ---------------------------------------------------------------------------

export async function runXmlstockGoogleSerp(args: XmlstockGoogleSerpInput) {
  const canonical = canonicalArgs(args);
  const user = process.env.XMLSTOCK_USER ?? "";
  const key  = process.env.XMLSTOCK_KEY  ?? "";

  const payload = await withCache(
    {
      toolName:     "xmlstock_google_serp",
      accountId:    null,
      args:         canonical,
      forceRefresh: args.force_refresh,
      skipCacheIf:  (r: unknown) => (r as { isError?: boolean }).isError === true,
    },
    async () => {
      const r = await fetchGoogleSerp({
        user, key,
        query:  canonical.query as string,
        domain: canonical.domain as string,
        device: canonical.device as string,
        page:   canonical.page as number,
        ...(canonical.lr  !== undefined && { lr:  canonical.lr  as number }),
        ...(canonical.tbs !== undefined && { tbs: canonical.tbs as string }),
        ...(canonical.hl  !== undefined && { hl:  canonical.hl  as string }),
      });

      if (!r.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(r.error) }],
        };
      }

      const parsed = parseGoogleSerpXml(r.xml);
      incrementUsage("xmlstock_google_serp", "google");
      const now = Date.now();
      return {
        engine:            "google" as const,
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
