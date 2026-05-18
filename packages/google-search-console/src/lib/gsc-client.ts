import {
  getGoogleAccessToken,
  classifyGoogleError,
  GoogleAuthError,
} from "@ohmy-seo/mcp-core/google-oauth";
import { request } from "@ohmy-seo/mcp-core/http";
import { ApiError, AuthError, RateLimitError } from "@ohmy-seo/mcp-core/errors";
import type { AccountRow } from "./account-resolver.js";
import { listOAuthApps, findOAuthAppByLabel } from "./db/oauth-apps-repo.js";

const DEFAULT_BASE_URL = "https://searchconsole.googleapis.com";
const PKG_NAME = "google-search-console";

export interface GscCallParams {
  account: AccountRow;
  scope: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  baseUrl?: string;
  query?: Record<string, string>;
  body?: object;
}

export interface GscCallResult {
  ok: boolean;
  status: number;
  data: unknown;
}

/**
 * Executes a Google Search Console (or Indexing API) HTTP call.
 *
 * 1. Defensive scope check on account.scopes_granted.
 * 2. Obtains a fresh access token via getGoogleAccessToken.
 * 3. Builds URL, fires fetch, parses response.
 * 4. On status >= 400 classifies the error and returns ok:false.
 *
 * NEVER logs the Authorization token or sensitive query params.
 */
export async function executeGscCall(params: GscCallParams): Promise<GscCallResult> {
  const { account, scope, method, path, query, body } = params;
  const baseUrl = params.baseUrl ?? DEFAULT_BASE_URL;

  // 1. Defensive scope check
  const granted = (account.scopes_granted ?? "").split(" ").filter(Boolean);
  if (!granted.includes(scope)) {
    throw new Error(
      `Account "${account.label}" is missing required scope "${scope}". ` +
        `Re-authorize via start_google_oauth_flow.`
    );
  }

  // 2. Obtain access token
  let app: { client_id: string; client_secret: string } | undefined;
  if (account.auth_method === "oauth_user" && account.oauth_app_id != null) {
    const appRow = resolveOAuthApp(PKG_NAME, account.oauth_app_id);
    if (!appRow) {
      throw new GoogleAuthError(
        `OAuth app id=${account.oauth_app_id} not found for account "${account.label}"`
      );
    }
    app = { client_id: appRow.client_id, client_secret: appRow.client_secret };
  }

  // AccountRow uses null for absent tokens; AccountInput expects undefined
  const accountInput = {
    ...account,
    access_token: account.access_token ?? undefined,
    refresh_token: account.refresh_token ?? undefined,
    service_account_json: account.service_account_json ?? undefined,
  };
  const token = await getGoogleAccessToken(accountInput, app);

  // 3. Build URL
  const url = buildUrl(baseUrl, path, query);

  // 4. Fire request — Authorization header not logged
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const init: Parameters<typeof request>[1] = {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  try {
    const response = await request(url, init);
    return { ok: true, status: response.status, data: response.data };
  } catch (err) {
    if (err instanceof AuthError) {
      const classified = classifyGoogleError({ status: err.status });
      return { ok: false, status: err.status, data: { error: classified } };
    }
    if (err instanceof RateLimitError) {
      throw err; // propagate — callers must handle backoff
    }
    if (err instanceof ApiError) {
      let parsedBody: unknown = err.body;
      try {
        parsedBody = JSON.parse(err.body);
      } catch {
        // keep as raw string
      }
      const classified = classifyGoogleError(parsedBody);
      return { ok: false, status: err.status, data: { error: classified, raw: parsedBody } };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildUrl(base: string, path: string, query?: Record<string, string>): string {
  // Ensure base has no trailing slash before joining
  const origin = base.replace(/\/$/, "");
  const fullPath = path.startsWith("/") ? path : "/" + path;
  const url = new URL(origin + fullPath);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

/**
 * Resolves a full OAuth app row (including client_secret) by numeric id.
 * Uses listOAuthApps to find the label, then fetches the full row.
 */
function resolveOAuthApp(pkg: string, id: number) {
  const apps = listOAuthApps(pkg);
  const found = apps.find((a) => a.id === id);
  if (!found) return null;
  return findOAuthAppByLabel(pkg, found.label);
}
