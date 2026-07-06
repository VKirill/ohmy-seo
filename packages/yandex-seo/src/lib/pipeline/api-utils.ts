/**
 * pipeline/api-utils.ts — Direct API response parsing helpers, image fetch,
 * filesystem + ledger utilities, and campaign dedupe lookups.
 *
 * Split out of upload-pipeline.ts (move-only refactor). No behavior change.
 */

import * as fs from "fs";

import { executeApiCall } from "../api-gateway.js";

/** Fetch image bytes from URL and return base64 + format. Throws if unusable. */
export async function fetchImageAsBase64(url: string): Promise<{ base64: string; format: "JPEG" | "PNG" }> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Image URL returned ${resp.status}: ${url}`);
  }
  const contentType = resp.headers.get("content-type") ?? "";
  const format: "JPEG" | "PNG" = contentType.includes("png") ? "PNG" : "JPEG";
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error(`Image exceeds 10 MB: ${url}`);
  }
  return { base64: buffer.toString("base64"), format };
}

/** Extract numeric ID from a Direct API successful response. */
export function extractId(data: unknown): number {
  const apiError = formatDirectApiError(data);
  if (apiError) {
    throw new Error(apiError);
  }

  const result = (data as { result?: { AddResults?: Array<{ Id?: number }> } })?.result
    ?.AddResults?.[0]?.Id;
  if (typeof result !== "number") {
    throw new Error(`Unexpected API response shape: ${JSON.stringify(data)}`);
  }
  return result;
}

/** Surface Direct's request-level { error } envelope instead of hiding it as id_extraction_failed. */
export function formatDirectApiError(data: unknown): string | undefined {
  const err = (data as { error?: Record<string, unknown> } | undefined)?.error;
  if (!err) return undefined;
  const code = err["error_code"] ?? "unknown";
  const text = err["error_string"] ?? "Direct API error";
  const detail = err["error_detail"];
  return `Direct API error ${String(code)}: ${String(text)}${detail ? ` — ${String(detail)}` : ""}`;
}

export function ledgerOp(entry: { op?: string; signature: string }): string {
  return entry.op && entry.op.length > 0 ? entry.op : entry.signature.split(":", 1)[0] ?? "";
}

/** Extract image hash from a Direct API AdImages.add response. */
export function extractImageHash(data: unknown): string {
  const hash = (data as { result?: { AddResults?: Array<{ AdImageHash?: string }> } })?.result
    ?.AddResults?.[0]?.AdImageHash;
  if (typeof hash !== "string") {
    throw new Error(`Unexpected image API response shape: ${JSON.stringify(data)}`);
  }
  return hash;
}

/** Ensure directory exists. */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Find an existing campaign by name in a list of campaigns returned by the API.
 * Returns the Id if found and the campaign is in a reusable state, undefined otherwise.
 * Pushes a warning to `warnings` (if provided) when a matched campaign is in a suspicious state.
 * Pure function aside from the optional warnings push.
 */
export function findExistingCampaignId(
  existingCampaigns: Array<{ Id: number; Name: string; Status?: string }>,
  name: string,
  warnings?: Array<{ cluster_id: string; step: string; error: string }>,
  cluster_id?: string
): number | undefined {
  // Filter to non-ARCHIVED campaigns with the matching name
  const nonArchivedMatches = existingCampaigns.filter(
    (c) => c.Name === name && c.Status !== "ARCHIVED"
  );

  if (nonArchivedMatches.length === 0) {
    return undefined;
  }

  // Fail-closed: if multiple non-ARCHIVED campaigns share the same name, refuse to guess
  if (nonArchivedMatches.length > 1) {
    throw new Error(
      `Ambiguous dedupe: ${nonArchivedMatches.length} non-ARCHIVED campaigns named "${name}" ` +
      `(IDs: ${nonArchivedMatches.map((c) => c.Id).join(", ")}). ` +
      `Cannot safely deduplicate — resolve the duplicates in Yandex Direct UI first.`
    );
  }

  const match = nonArchivedMatches[0];

  // Warn on unexpected states (anything other than the normal active/draft states)
  const NORMAL_STATES = new Set(["DRAFT", "ACTIVE", "SUSPENDED", "ENDED", "OFF", "CONVERTED"]);
  if (match.Status !== undefined && !NORMAL_STATES.has(match.Status)) {
    warnings?.push({
      cluster_id: cluster_id ?? "unknown",
      step: "dedupe",
      error: `reusing campaign Id=${match.Id} Name="${name}" in unexpected state "${match.Status}" — verify it is not a stale/failed campaign`,
    });
  }

  return match.Id;
}

/**
 * Fetch all campaigns for the account (Id + Name + Status).
 * Called once before processing clusters when dedupe_by_name=true.
 * Paginates using Page.Limit + Page.Offset until all campaigns are fetched.
 * THROWS on any API error (fail-closed) — a lookup failure must not silently
 * fall back to create (that would produce duplicates).
 *
 * Exported for unit testing only.
 */
export async function fetchExistingCampaigns(
  account_label: string | undefined,
  client_login: string | undefined
): Promise<Array<{ Id: number; Name: string; Status?: string }>> {
  const PAGE_LIMIT = 10000;
  const allCampaigns: Array<{ Id: number; Name: string; Status?: string }> = [];
  let offset = 0;

  for (;;) {
    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/campaigns",
      method: "POST",
      body: {
        method: "get",
        params: {
          SelectionCriteria: {},
          FieldNames: ["Id", "Name", "Status"],
          Page: { Limit: PAGE_LIMIT, Offset: offset },
        },
      },
      account: account_label,
      client_login,
    });

    if (!result.ok) {
      throw new Error(
        `fetchExistingCampaigns failed (HTTP ${result.status}): ${JSON.stringify(result.body)}`
      );
    }

    const data = result.data as {
      result?: {
        Campaigns?: Array<{ Id?: number; Name?: string; Status?: string }>;
        LimitedBy?: number;
      };
    };

    const page = (data?.result?.Campaigns ?? []).filter(
      (c): c is { Id: number; Name: string; Status?: string } =>
        typeof c.Id === "number" && typeof c.Name === "string"
    );

    allCampaigns.push(...page);

    const limitedBy = data?.result?.LimitedBy;
    if (limitedBy === undefined || page.length < PAGE_LIMIT) {
      // No more pages
      break;
    }
    offset = limitedBy;
  }

  return allCampaigns;
}
