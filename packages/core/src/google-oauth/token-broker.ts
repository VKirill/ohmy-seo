/**
 * Token broker for Google OAuth access tokens.
 *
 * Pure: does NOT write to any DB. Caller must persist updated tokens.
 *
 * Mutex strategy: one in-flight Promise per accountId.
 * Concurrent calls for the same accountId share one refresh HTTP call;
 * different accountIds run in parallel.
 */

import { refreshAccessToken } from './oauth-user-flow.js';
import {
  parseServiceAccountJson,
  signJwtAssertion,
  exchangeJwtForAccessToken,
} from './service-account-flow.js';
import { GoogleAuthError, classifyGoogleError } from './errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccountInput {
  id: number;
  auth_method: 'oauth_user' | 'service_account';
  /** Already decrypted access token. */
  access_token?: string;
  /** Already decrypted refresh token. */
  refresh_token?: string;
  /** Unix timestamp in milliseconds (Date.now() scale). */
  expires_at: number;
  /** Already decrypted Service Account JSON string. */
  service_account_json?: string;
  /** Space-separated OAuth scopes. */
  scopes_granted: string;
}

export interface OAuthAppInput {
  client_id: string;
  client_secret: string;
}

// ---------------------------------------------------------------------------
// In-flight mutex
// ---------------------------------------------------------------------------

/**
 * Per-accountId in-flight map.
 * While a refresh is running for account N, any concurrent call for N
 * receives the same Promise rather than issuing a second HTTP request.
 */
const inFlight = new Map<number, Promise<string>>();

// Refresh threshold: 5 minutes (300 000 ms) before expiry
const REFRESH_THRESHOLD_MS = 300_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a valid access token for the given account.
 *
 * Fast path: if the token is still valid (expires_at > now + 5 min), return it.
 * Slow path: refresh the token (oauth_user via refresh_token, service_account via JWT).
 *
 * Throws GoogleAuthError on invalid_grant / 401 / 403 — caller must handle
 * re-auth by prompting the user to reconnect.
 */
export async function getGoogleAccessToken(
  account: AccountInput,
  app?: OAuthAppInput
): Promise<string> {
  // Fast path: token still valid
  if (
    account.access_token &&
    account.expires_at > Date.now() + REFRESH_THRESHOLD_MS
  ) {
    return account.access_token;
  }

  // Slow path: share in-flight promise for same accountId
  const existing = inFlight.get(account.id);
  if (existing !== undefined) {
    return existing;
  }

  const promise = doRefresh(account, app).finally(() => {
    inFlight.delete(account.id);
  });

  inFlight.set(account.id, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Internal refresh logic
// ---------------------------------------------------------------------------

async function doRefresh(
  account: AccountInput,
  app?: OAuthAppInput
): Promise<string> {
  try {
    if (account.auth_method === 'oauth_user') {
      if (!app) {
        throw new GoogleAuthError(
          'OAuthAppInput (client_id + client_secret) required for oauth_user refresh'
        );
      }
      if (!account.refresh_token) {
        throw new GoogleAuthError(
          `Account id=${account.id}: refresh_token is missing, re-auth required`
        );
      }

      const tokenResponse = await refreshAccessToken({
        client_id: app.client_id,
        client_secret: app.client_secret,
        refresh_token: account.refresh_token,
      });

      return tokenResponse.access_token;
    }

    // service_account path
    if (!account.service_account_json) {
      throw new GoogleAuthError(
        `Account id=${account.id}: service_account_json is missing`
      );
    }

    const sa = parseServiceAccountJson(account.service_account_json);
    const scopes = account.scopes_granted
      .split(' ')
      .map((s) => s.trim())
      .filter(Boolean);

    const assertion = signJwtAssertion({ sa, scopes });
    const tokenResponse = await exchangeJwtForAccessToken({
      assertion,
      tokenUri: sa.token_uri,
    });

    return tokenResponse.access_token;
  } catch (err) {
    // Re-throw GoogleAuthError as-is (already classified)
    if (err instanceof GoogleAuthError) throw err;

    // Classify and wrap
    const classified = classifyGoogleError(err);

    if (
      classified.kind === 'invalid_grant' ||
      classified.kind === 'unauthorized' ||
      classified.kind === 'forbidden'
    ) {
      throw new GoogleAuthError(
        `[${classified.kind}] ${classified.message} (account id=${account.id})`
      );
    }

    throw new GoogleAuthError(
      `[${classified.kind}] Token refresh failed for account id=${account.id}: ${classified.message}`
    );
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Clears the in-flight map. Intended for use in unit tests only. */
export function _clearInflight(): void {
  inFlight.clear();
}
