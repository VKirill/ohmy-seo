import {
  getGoogleAccessToken,
  classifyGoogleError,
  GoogleAuthError,
} from "@ohmy-seo/mcp-core/google-oauth";
import { request } from "@ohmy-seo/mcp-core/http";
import { ApiError, AuthError, RateLimitError } from "@ohmy-seo/mcp-core/errors";
import { getDb } from "@ohmy-seo/mcp-core/db";
import { decryptSecret } from "@ohmy-seo/mcp-core/crypto";
import type { AccountRow } from "./account-resolver.js";

const DATA_API_BASE = "https://analyticsdata.googleapis.com";
const PKG_NAME = "ga4";

export interface Ga4CallParams {
  account: AccountRow;
  scope: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  baseUrl?: string;
  query?: Record<string, string>;
  body?: object;
}

export interface Ga4CallResult {
  ok: boolean;
  status: number;
  data: unknown;
}

/**
 * Executes a GA4 HTTP call against the Data API or Admin API.
 *
 * - Default baseUrl: https://analyticsdata.googleapis.com (Data API v1beta)
 * - Pass baseUrl='https://analyticsadmin.googleapis.com' for Admin API v1beta
 *
 * 1. Defensive scope check on account.scopes_granted.
 * 2. Obtains a fresh access token via getGoogleAccessToken.
 * 3. Builds URL, fires fetch, parses response.
 * 4. On status >= 400 classifies the error via classifyGoogleError.
 *
 * NEVER logs the Authorization token.
 */
export async function executeGa4Call(params: Ga4CallParams): Promise<Ga4CallResult> {
  const { account, scope, method, path, query, body } = params;
  const baseUrl = params.baseUrl ?? DATA_API_BASE;

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
    const appRow = findOAuthAppById(PKG_NAME, account.oauth_app_id);
    if (!appRow) {
      throw new GoogleAuthError(
        `OAuth app id=${account.oauth_app_id} not found for account "${account.label}"`
      );
    }
    app = appRow;
  }

  const token = await getGoogleAccessToken(
    {
      ...account,
      access_token: account.access_token ?? undefined,
      refresh_token: account.refresh_token ?? undefined,
      service_account_json: account.service_account_json ?? undefined,
    },
    app
  );

  // 3. Build URL
  const url = buildUrl(baseUrl, path, query);

  // 4. Build headers (token never logged)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const init: Parameters<typeof request>[1] = {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  // 5. Fire request
  try {
    const response = await request(url, init);
    return { ok: true, status: response.status, data: response.data };
  } catch (err) {
    if (err instanceof AuthError) {
      const classified = classifyGoogleError({ status: err.status });
      return { ok: false, status: err.status, data: { error: classified } };
    }
    if (err instanceof RateLimitError) {
      throw err; // let caller handle backoff
    }
    if (err instanceof ApiError) {
      let parsedBody: unknown = err.body;
      try {
        parsedBody = JSON.parse(err.body);
      } catch {
        // leave as string
      }
      const classified = classifyGoogleError(parsedBody);
      return { ok: false, status: err.status, data: { error: classified, raw: parsedBody } };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUrl(base: string, path: string, query?: Record<string, string>): string {
  const url = new URL(path, base.endsWith("/") ? base : base + "/");
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

type AppSecretRow = { client_id: string; client_secret_enc: Buffer };

/** Looks up OAuth app by numeric id and returns client_id + decrypted client_secret. */
function findOAuthAppById(
  pkg: string,
  id: number
): { client_id: string; client_secret: string } | null {
  const db = getDb(pkg);
  const row = db
    .prepare<[number], AppSecretRow>(
      `SELECT client_id, client_secret_enc FROM google_oauth_apps WHERE id = ?`
    )
    .get(id);
  if (!row) return null;
  return { client_id: row.client_id, client_secret: decryptSecret(row.client_secret_enc) };
}
