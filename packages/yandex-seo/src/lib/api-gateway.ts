import { getApiSpec, type ApiName } from "./api/endpoints-spec.js";
import { buildUrl } from "./api/url-builder.js";
import { resolveAccount } from "./account-resolver.js";
import { getAccessToken } from "./oauth/token-broker.js";
import { request } from "@ohmy-seo/mcp-core/http";
import { AuthError, RateLimitError, ApiError } from "@ohmy-seo/mcp-core/errors";
import { withCache, type CacheableTool } from "@ohmy-seo/mcp-core/cache";
import { invalidateOnWrite } from "./api/invalidation.js";

export interface ExecuteOpts {
  apiName: ApiName;
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, unknown>;
  body?: unknown;
  account?: string;
  client_login?: string;
  force_refresh?: boolean;
}

export type ExecuteResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; body: unknown };

function tryJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Core API gateway — resolves account, obtains token, builds URL, fires request.
 * GET requests are wrapped in withCache (skipCacheIf skips 4xx responses).
 * Non-GET success calls invalidateOnWrite to purge stale GET cache entries.
 */
export async function executeApiCall(opts: ExecuteOpts): Promise<ExecuteResult> {
  const spec = getApiSpec(opts.apiName);

  // Resolve account: explicit label from opts.account, or implicit by requiredScope
  const acc = resolveAccount(spec.requiredScope, opts.account);

  const token = await getAccessToken(acc.id);

  const url = buildUrl(spec.baseUrl, opts.endpoint, opts.params, opts.method);

  const headers: Record<string, string> = {
    Authorization: `${spec.authPrefix} ${token}`,
  };

  if (opts.method === "POST" || opts.method === "PUT") {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }

  if (spec.supportsClientLogin && opts.client_login) {
    headers["Client-Login"] = opts.client_login;
  }

  const init: Parameters<typeof request>[1] = {
    method: opts.method,
    headers,
    ...(opts.body !== undefined &&
    (opts.method === "POST" || opts.method === "PUT")
      ? { body: JSON.stringify(opts.body) }
      : {}),
  };

  const doFetch = async (): Promise<ExecuteResult> => {
    try {
      const response = await request(url, init);
      return { ok: true, status: response.status, data: response.data };
    } catch (e) {
      if (e instanceof AuthError) throw e;
      if (e instanceof RateLimitError) throw e;
      if (e instanceof ApiError) {
        return { ok: false, status: e.status, body: tryJson(e.body) };
      }
      throw e;
    }
  };

  const isGet = opts.method === "GET";

  if (!isGet) {
    const result = await doFetch();
    if (result.ok) {
      const toolName = `yandex_${opts.apiName}_api` as CacheableTool;
      invalidateOnWrite(toolName, opts.apiName, opts.endpoint);
    }
    return result;
  }

  const toolName = `yandex_${opts.apiName}_api` as CacheableTool;
  const cacheArgs: Record<string, unknown> = {
    endpoint: opts.endpoint,
    method: opts.method,
    params: opts.params ?? null,
    body: opts.body ?? null,
  };

  return withCache<ExecuteResult>(
    {
      toolName,
      accountId: acc.id,
      args: cacheArgs,
      forceRefresh: opts.force_refresh ?? false,
      skipCacheIf: (r) => !r.ok,
    },
    doFetch,
  );
}
