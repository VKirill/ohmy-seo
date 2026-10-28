import { fetch, type RequestInit } from "undici";
import { AuthError, RateLimitError, ApiError, TransientNetworkError } from "./errors.js";
import { sanitizeForOutput } from "./errors.js";
import { parseJsonSafe } from "./json-safe.js";

export type HttpResponse = {
  data: unknown;
  status: number;
  headers: Record<string, string>;
};

export type RequestOptions = {
  /** Time to wait for the response headers; defaults to HTTP_TIMEOUT_MS (30 s). */
  timeoutMs?: number;
};

/**
 * Fetch with a timeout. A timeout or a connection failure before any response
 * throws TransientNetworkError, so tools can report it as retryable instead of
 * a bare AbortError / "fetch failed".
 */
export async function request(url: string, init?: RequestInit, opts: RequestOptions = {}): Promise<HttpResponse> {
  const timeoutMs = opts.timeoutMs ?? parseInt(process.env.HTTP_TIMEOUT_MS ?? "30000", 10);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    "User-Agent": "mcp-core/0.1.0",
    "Accept": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) throw new TransientNetworkError("timeout", timeoutMs);
    // undici reports resets, DNS and TLS failures as TypeError("fetch failed").
    if (e instanceof TypeError && e.message === "fetch failed") throw new TransientNetworkError("network", timeoutMs);
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const { status } = response;

  if (status === 401) {
    throw new AuthError(status);
  }

  if (status === 403) {
    const body = await response.text();
    throw new ApiError(status, body);
  }

  if (status === 429) {
    const ra = response.headers.get("retry-after");
    throw new RateLimitError(parseInt(ra ?? "60", 10));
  }

  if (status >= 400) {
    const body = await response.text();
    throw new ApiError(status, body);
  }

  // Parse the body big-int-safe: Yandex ad Ids exceed 2^53 and response.json()
  // would silently round them. parseJsonSafe keeps such Ids as exact strings.
  const rawBody = await response.text();
  const data = rawBody.length > 0 ? parseJsonSafe(rawBody) : undefined;
  const respHeaders = Object.fromEntries(
    [...response.headers.entries()].filter(([k]) => k.toLowerCase() !== "authorization")
  );

  return { data, status, headers: respHeaders };
}

export function safeLogUrl(url: string): string {
  return sanitizeForOutput(url);
}
