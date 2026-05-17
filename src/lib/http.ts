import { fetch, type RequestInit } from "undici";
import { AuthError, RateLimitError, ApiError } from "./errors.js";
import { sanitizeForOutput } from "./errors.js";

export type HttpResponse = {
  data: unknown;
  status: number;
  headers: Record<string, string>;
};

export async function request(url: string, init?: RequestInit): Promise<HttpResponse> {
  const timeoutMs = parseInt(process.env.HTTP_TIMEOUT_MS ?? "30000", 10);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    "User-Agent": "mcp-yandex-seo/0.5.0",
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
  } finally {
    clearTimeout(timer);
  }

  const { status } = response;

  if (status === 401 || status === 403) {
    throw new AuthError(status);
  }

  if (status === 429) {
    const ra = response.headers.get("retry-after");
    throw new RateLimitError(parseInt(ra ?? "60", 10));
  }

  if (status >= 400) {
    const body = await response.text();
    throw new ApiError(status, body);
  }

  const data = await response.json();
  const respHeaders = Object.fromEntries(
    [...response.headers.entries()].filter(([k]) => k.toLowerCase() !== "authorization")
  );

  return { data, status, headers: respHeaders };
}

export function safeLogUrl(url: string): string {
  return sanitizeForOutput(url);
}
