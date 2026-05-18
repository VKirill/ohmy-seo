/**
 * GTM HTTP client.
 *
 * Wraps fetch calls to the GTM API v2 with:
 * - OAuth bearer token via getGoogleAccessToken
 * - etag/fingerprint extraction on GET (both HTTP ETag header and body `fingerprint` field)
 * - If-Match header on write methods when requireEtag is true
 * - 412 Precondition Failed → EtagConflictError
 * - NEVER logs the access token
 */

import { getGoogleAccessToken } from "@ohmy-seo/mcp-core/google-oauth";
import { getEtag, setEtag } from "./etag-cache.js";
import type { AccountRow } from "./account-resolver.js";

const GTM_BASE = "https://tagmanager.googleapis.com/tagmanager/v2";

// Methods that mutate state and should send If-Match
const WRITE_METHODS = new Set(["PUT", "PATCH", "DELETE", "POST"]);

// Methods that are GET-style and should capture etag from response
const READ_METHODS = new Set(["GET"]);

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class EtagConflictError extends Error {
  constructor() {
    super("Concurrent edit detected — re-read resource before retrying");
    this.name = "EtagConflictError";
  }
}

export class MissingEtagError extends Error {
  constructor(path: string) {
    super(
      `No cached etag for "${path}". ` +
        "Read resource first via gtm_list_* to get etag (concurrent-edit safeguard)"
    );
    this.name = "MissingEtagError";
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GtmCallParams {
  /** Resolved Google account row (with decrypted tokens). */
  account: AccountRow;
  /**
   * OAuth scope for which the token must be valid.
   * (The caller is responsible for ensuring the account has this scope.)
   */
  scope: string;
  /** HTTP method. */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * Resource path relative to the GTM base URL, e.g.
   * "accounts/123/containers/456/workspaces/1/tags".
   */
  path: string;
  /** URL query params (appended as ?key=value). */
  query?: Record<string, string>;
  /** Request body for write methods. Must be JSON-serialisable. */
  body?: unknown;
  /**
   * When true, the client will look up the cached etag for this path and send
   * it as an If-Match header. Throws MissingEtagError if no etag is cached.
   */
  requireEtag?: boolean;
}

export interface GtmCallResult {
  ok: boolean;
  status: number;
  data: unknown;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Execute one GTM API call.
 *
 * - GET responses: extracts etag from response header or body `fingerprint` field
 *   and stores it in the etag cache keyed by `path`.
 * - Write methods (PUT/PATCH/DELETE/POST) with requireEtag=true: reads cached etag
 *   and sends it as the If-Match header. Throws MissingEtagError if not cached.
 * - HTTP 412 Precondition Failed → throws EtagConflictError.
 */
export async function executeGtmCall(params: GtmCallParams): Promise<GtmCallResult> {
  const { account, method, path, query, body, requireEtag } = params;

  // AccountRow uses null for absent tokens; AccountInput expects undefined
  const accountInput = {
    ...account,
    access_token: account.access_token ?? undefined,
    refresh_token: account.refresh_token ?? undefined,
    service_account_json: account.service_account_json ?? undefined,
  };

  // Obtain a valid access token (never log it)
  const token = await getGoogleAccessToken(accountInput);

  // Build URL
  const url = buildUrl(path, query);

  // Build headers
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  // If-Match for write methods when required
  if (requireEtag && WRITE_METHODS.has(method)) {
    const cached = getEtag(path);
    if (!cached) {
      throw new MissingEtagError(path);
    }
    headers["If-Match"] = cached;
  }

  // Execute request
  const fetchInit: RequestInit = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  const response = await fetch(url, fetchInit);
  const { status } = response;

  // 412 Precondition Failed — etag/fingerprint mismatch
  if (status === 412) {
    throw new EtagConflictError();
  }

  // Parse body
  const contentType = response.headers.get("content-type") ?? "";
  let data: unknown = null;
  if (contentType.includes("application/json") && status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else if (status !== 204) {
    // Non-JSON, non-empty body — return as text
    const text = await response.text();
    data = text || null;
  }

  const ok = status >= 200 && status < 300;

  // On successful GET: capture etag from HTTP header or body fingerprint
  if (ok && READ_METHODS.has(method)) {
    captureEtag(path, response.headers, data);
  }

  return { ok, status, data };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUrl(path: string, query?: Record<string, string>): string {
  const base = `${GTM_BASE}/${path}`;
  if (!query || Object.keys(query).length === 0) return base;
  const qs = new URLSearchParams(query).toString();
  return `${base}?${qs}`;
}

/**
 * Attempts to extract an etag from the response and stores it in the cache.
 * GTM uses the `fingerprint` field in the body as the primary etag mechanism.
 * The HTTP ETag response header is also accepted as a fallback.
 */
function captureEtag(
  path: string,
  responseHeaders: Headers,
  data: unknown
): void {
  // Prefer body fingerprint (GTM primary mechanism)
  if (data !== null && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record["fingerprint"] === "string" && record["fingerprint"]) {
      setEtag(path, record["fingerprint"]);
      return;
    }
  }

  // Fallback: HTTP ETag header
  const headerEtag = responseHeaders.get("etag");
  if (headerEtag) {
    setEtag(path, headerEtag);
  }
}
