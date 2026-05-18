/**
 * xmlstock-client.ts — HTTP fetch + retry + error envelope detection.
 *
 * Does NOT parse SERP XML — that lives in xmlstock-parse.ts (TASK-908).
 * Does NOT log URLs or credentials.
 */

import { classifyError } from "./xmlstock-errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const XMLSTOCK_BASE = "https://xmlstock.com";

/** Delay before retrying a 500-502 HTTP error. */
const HTTP_5XX_RETRY_DELAY_MS = 5_000;

/** Delay before retrying a 503 HTTP error. */
const HTTP_503_RETRY_DELAY_MS = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type XmlstockResult =
  | { ok: true; xml: string }
  | { ok: false; error: { code: number; message: string; billed: boolean }; status: "queue" | "error" };

export type YandexParams = {
  user: string;
  key: string;
  query: string;
  lr?: string | number;
  domain?: string;
  device?: string;
  groupby?: string;
  page?: number;
  sortby?: string;
  filter?: string;
  maxpassages?: number;
  noreask?: 0 | 1;
  delayed?: 0 | 1;
  req_id?: string;
  [extra: string]: string | number | undefined;
};

export type GoogleParams = {
  user: string;
  key: string;
  query: string;
  lr?: string | number;
  domain?: string;
  device?: string;
  page?: number;
  start?: number;
  tbm?: string;
  tbs?: string;
  hl?: string;
  related?: 0 | 1;
  filter?: 0 | 1;
  punycode?: 0 | 1;
  hlword?: 0 | 1;
  nfpr?: 0 | 1;
  safe?: string;
  [extra: string]: string | number | undefined;
};

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

/**
 * Compose an XMLStock request URL.
 * NEVER include this URL in log output — it contains user/key credentials.
 */
export function buildXmlstockUrl(
  engine: "yandex" | "google",
  params: Record<string, string | number | undefined>
): string {
  const path = engine === "yandex" ? "/yandex/xml/" : "/google/xml/";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) {
      qs.set(k, String(v));
    }
  }
  return `${XMLSTOCK_BASE}${path}?${qs.toString()}`;
}

// ---------------------------------------------------------------------------
// Error envelope detection
// ---------------------------------------------------------------------------

/**
 * Parse an HTTP-200 XMLStock response body for the embedded error envelope.
 *
 * Handles whitespace and both quote styles, e.g.:
 *   <error code="210">Queue</error>
 *   <error code='48'>No results</error>
 *   <error  code = "32" >Limit exceeded</error>
 *   <error code="-34">Invalid key</error>
 *
 * Returns null if the body is a successful SERP (no error tag).
 */
export function detectXmlstockError(
  xml: string
): { code: number; message: string } | null {
  const ERROR_PATTERN = /<error\s+code\s*=\s*['"](-?\d+)['"'][^>]*>([^<]*)<\/error>/;
  const match = ERROR_PATTERN.exec(xml);
  if (!match) return null;
  return {
    code: parseInt(match[1], 10),
    message: match[2].trim(),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL and return the raw text body.
 * On HTTP non-200: applies one retry for 5xx errors with a status-appropriate delay.
 */
async function fetchText(
  url: string
): Promise<{ ok: true; text: string } | { ok: false; httpStatus: number }> {
  const attempt = async () => globalThis.fetch(url, { headers: { "Accept-Encoding": "gzip" } });

  let res = await attempt();

  // Single retry on 5xx with per-status delay
  if (res.status >= 500) {
    const delay = res.status === 503 ? HTTP_503_RETRY_DELAY_MS : HTTP_5XX_RETRY_DELAY_MS;
    await sleep(delay);
    res = await attempt();
  }

  if (res.status !== 200) {
    return { ok: false, httpStatus: res.status };
  }

  return { ok: true, text: await res.text() };
}

// ---------------------------------------------------------------------------
// Core fetch-with-retry logic
// ---------------------------------------------------------------------------

/**
 * Fetch XMLStock, handling transient envelope errors via the error catalog.
 *
 * Branches on classifyError(engine, code):
 *   no_results → ok:true (parser layer handles empty SERP)
 *   transient   → sleep + retry up to meta.maxRetries
 *   fatal       → return ok:false immediately
 */
async function fetchWithRetry(
  engine: "yandex" | "google",
  url: string
): Promise<XmlstockResult> {
  // Per-code retry counters (each transient code has its own maxRetries)
  const retryCounts: Record<number, number> = {};

  // Outer loop: at most sum-of-maxRetries iterations; bounded by per-code check inside.
  // In practice the loop runs ≤ (max maxRetries + 1) times for any single code.
  const MAX_TOTAL_ITERATIONS = 20;

  for (let iteration = 0; iteration < MAX_TOTAL_ITERATIONS; iteration++) {
    const fetched = await fetchText(url);

    if (!fetched.ok) {
      // HTTP non-200 (already did one inner retry in fetchText)
      return {
        ok: false,
        error: {
          code: fetched.httpStatus,
          message: `HTTP error ${fetched.httpStatus}`,
          billed: false,
        },
        status: "error",
      };
    }

    const envelope = detectXmlstockError(fetched.text);

    if (envelope === null) {
      // Successful SERP — no error tag
      return { ok: true, xml: fetched.text };
    }

    const meta = classifyError(engine, envelope.code);

    if (meta.kind === "no_results") {
      // Code 15: valid empty SERP — return ok so parser can emit empty result set
      return { ok: true, xml: fetched.text };
    }

    if (meta.kind === "transient" && meta.retryDelayMs !== undefined && meta.maxRetries !== undefined) {
      retryCounts[envelope.code] = (retryCounts[envelope.code] ?? 0) + 1;
      const attempt = retryCounts[envelope.code];

      if (attempt <= meta.maxRetries) {
        console.error(
          `XMLStock ${engine} code ${envelope.code} (${meta.kind}) retry ${attempt}/${meta.maxRetries} after ${meta.retryDelayMs}ms`
        );
        await sleep(meta.retryDelayMs);
        continue; // Retry same URL
      }

      // Exhausted retries for this transient code
      return {
        ok: false,
        error: { code: envelope.code, message: meta.message, billed: meta.billed },
        status: "queue",
      };
    }

    // fatal (or transient without delay config — treat as fatal)
    return {
      ok: false,
      error: { code: envelope.code, message: meta.message, billed: meta.billed },
      status: "error",
    };
  }

  // Should be unreachable
  return {
    ok: false,
    error: { code: 0, message: "Unexpected client loop exit", billed: false },
    status: "error",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch Yandex SERP via xmlstock hybrid mode.
 * Handles transient errors (queue / RPS / cooldown) transparently.
 * Never logs the URL or credentials.
 */
export async function fetchYandexSerp(params: YandexParams): Promise<XmlstockResult> {
  const url = buildXmlstockUrl("yandex", params as Record<string, string | number | undefined>);
  return fetchWithRetry("yandex", url);
}

/**
 * Fetch Google SERP via xmlstock.
 * Handles transient errors (queue / RPS / channels) transparently.
 * Never logs the URL or credentials.
 */
export async function fetchGoogleSerp(params: GoogleParams): Promise<XmlstockResult> {
  const url = buildXmlstockUrl("google", params as Record<string, string | number | undefined>);
  return fetchWithRetry("google", url);
}
