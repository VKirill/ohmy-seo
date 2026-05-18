/**
 * xmlstock-errors.ts — Full error code catalog for Yandex and Google XMLStock endpoints.
 *
 * Sources: XMLStock official docs + errors.md skill reference.
 * HTTP-level errors (non-200) are NOT listed here — handled separately in xmlstock-client.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorKind = "transient" | "fatal" | "no_results";

export interface ErrorMeta {
  message: string;
  billed: boolean;
  kind: ErrorKind;
  /** How long to wait before the next retry (only set for transient codes). */
  retryDelayMs?: number;
  /** Maximum number of retry attempts (only set for transient codes). */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fill a range of consecutive integer codes with the same ErrorMeta. */
function fillRange(
  target: Record<number, ErrorMeta>,
  from: number,
  to: number,
  meta: ErrorMeta
): void {
  for (let code = from; code <= to; code++) {
    target[code] = meta;
  }
}

// ---------------------------------------------------------------------------
// Yandex error catalog
// ---------------------------------------------------------------------------

export const YANDEX_ERROR_CODES: Record<number, ErrorMeta> = {
  1: { message: "Query syntax error", billed: true, kind: "fatal" },
  2: { message: "Empty query", billed: false, kind: "fatal" },
  // 3-9: invalid parameter value (groupby / domain / delayed / device / page / lr / tbm)
  15: { message: "No results for query", billed: true, kind: "no_results" },
  18: {
    message: "Invalid XML body or unescaped characters (or page > 25)",
    billed: true,
    kind: "fatal",
  },
  19: { message: "Incompatible parameter combination", billed: true, kind: "fatal" },
  20: { message: "Unknown error", billed: false, kind: "fatal" },
  32: { message: "Daily request limit exceeded", billed: false, kind: "fatal" },
  37: { message: "Parameter error (missing required or mutually exclusive params)", billed: true, kind: "fatal" },
  55: {
    message: "RPS limit exceeded",
    billed: false,
    kind: "transient",
    retryDelayMs: 2_000,
    maxRetries: 3,
  },
  101: { message: "Service temporarily disabled", billed: false, kind: "fatal" },
  200: { message: "Insufficient balance — top up account", billed: false, kind: "fatal" },
  [-34]: { message: "Invalid user ID or API key", billed: false, kind: "fatal" },
  201: {
    message: "Cache repeat cooldown — wait 30 s before retrying",
    billed: false,
    kind: "transient",
    retryDelayMs: 30_000,
    maxRetries: 1,
  },
  202: {
    message: "Request not yet processed",
    billed: true,
    kind: "transient",
    retryDelayMs: 25_000,
    maxRetries: 3,
  },
  203: { message: "Request ID not found or expired", billed: false, kind: "fatal" },
  210: {
    message: "Request queued — processing",
    billed: true,
    kind: "transient",
    retryDelayMs: 25_000,
    maxRetries: 3,
  },
  300: { message: "Unknown error", billed: false, kind: "fatal" },
  10001: { message: "Query too long (> 400 characters)", billed: true, kind: "fatal" },
  10002: { message: "Query too long (> 40 words)", billed: true, kind: "fatal" },
};

// Expand range 3-9: invalid parameter values
fillRange(YANDEX_ERROR_CODES, 3, 9, {
  message: "Invalid parameter value (groupby / domain / delayed / device / page / lr / tbm)",
  billed: false,
  kind: "fatal",
});

// ---------------------------------------------------------------------------
// Google error catalog
// ---------------------------------------------------------------------------

export const GOOGLE_ERROR_CODES: Record<number, ErrorMeta> = {
  2: { message: "Empty query", billed: false, kind: "fatal" },
  // 3-14: invalid params (groupby / domain / hl / device / page / lr / tbm / punycode / hlword / nfpr / safe / uule)
  15: { message: "No results for query", billed: true, kind: "no_results" },
  // 20-25: data fetch failed
  31: { message: "User not registered", billed: false, kind: "fatal" },
  32: { message: "Daily request limit exceeded", billed: false, kind: "fatal" },
  42: { message: "API key error", billed: false, kind: "fatal" },
  55: {
    message: "RPS limit exceeded",
    billed: false,
    kind: "transient",
    retryDelayMs: 2_000,
    maxRetries: 3,
  },
  101: { message: "Service temporarily disabled", billed: false, kind: "fatal" },
  110: {
    message: "No free data-collection channels",
    billed: false,
    kind: "transient",
    retryDelayMs: 60_000,
    maxRetries: 3,
  },
  200: { message: "Insufficient balance — top up account", billed: false, kind: "fatal" },
};

// Expand range 3-14: invalid parameter values
fillRange(GOOGLE_ERROR_CODES, 3, 14, {
  message: "Invalid parameter value (groupby / domain / hl / device / page / lr / tbm / punycode / hlword / nfpr / safe / uule)",
  billed: false,
  kind: "fatal",
});

// Expand range 20-25: data fetch failed (transient — retry with backoff)
fillRange(GOOGLE_ERROR_CODES, 20, 25, {
  message: "Failed to fetch data from Google",
  billed: false,
  kind: "transient",
  retryDelayMs: 60_000,
  maxRetries: 3,
});

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

const FALLBACK_FATAL: ErrorMeta = { message: "", billed: false, kind: "fatal" };

/**
 * Classify an XMLStock error code for the given engine.
 *
 * Returns the matching ErrorMeta from the catalog, or a fallback
 * {kind:'fatal', billed:false} entry for unknown codes.
 */
export function classifyError(
  engine: "yandex" | "google",
  code: number
): ErrorMeta {
  const catalog =
    engine === "yandex" ? YANDEX_ERROR_CODES : GOOGLE_ERROR_CODES;
  return (
    catalog[code] ?? {
      ...FALLBACK_FATAL,
      message: `Unknown XMLStock code ${code}`,
    }
  );
}
