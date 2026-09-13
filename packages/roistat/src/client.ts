import { request } from "@ohmy-seo/mcp-core/http";
import {
  ApiError,
  AuthError,
  RateLimitError,
  sanitizeForOutput,
} from "@ohmy-seo/mcp-core/errors";

const BASE_URL = "https://cloud.roistat.com/api/v1";

export type RoistatMethod = "GET" | "POST";

export function resolveApiKey(): string {
  const apiKey = (process.env.ROISTAT_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error(
      "ROISTAT_API_KEY is not set. Copy it from https://cloud.roistat.com/user/profile/api.",
    );
  }
  return apiKey;
}

export function resolveProject(explicit?: string): string {
  const project = (explicit ?? process.env.ROISTAT_PROJECT_ID ?? "").trim();
  if (!project) {
    throw new Error("Pass project or set ROISTAT_PROJECT_ID.");
  }
  return project;
}

export function buildRoistatUrl(
  path: string,
  project?: string,
  params?: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(BASE_URL + (path.startsWith("/") ? path : `/${path}`));
  if (project) url.searchParams.set("project", project);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function callRoistat(input: {
  path: string;
  method: RoistatMethod;
  project?: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: object;
}): Promise<unknown> {
  const headers: Record<string, string> = { "Api-key": resolveApiKey() };
  const init: Parameters<typeof request>[1] = { method: input.method, headers };
  if (input.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(input.body);
  }
  const response = await request(
    buildRoistatUrl(input.path, input.project, input.params),
    init,
  );
  return response.data;
}

export function formatRoistatError(error: unknown): string {
  if (error instanceof AuthError) {
    return "Roistat rejected the API key. Check ROISTAT_API_KEY.";
  }
  if (error instanceof RateLimitError) {
    return `Roistat rate limit reached. Retry after ${error.retryAfterSec} seconds.`;
  }
  if (error instanceof ApiError) {
    return `Roistat API error ${error.status}: ${sanitizeForOutput(error.body).slice(0, 800)}`;
  }
  return sanitizeForOutput(error instanceof Error ? error.message : String(error)).slice(0, 800);
}
