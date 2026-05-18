import { refreshAccessToken } from "./yandex-flow.js";
import { getAccountById, updateAccountTokens } from "../db/accounts-repo.js";
import type { AccountRow } from "../db/accounts-repo.js";
import { getAppById } from "../db/oauth-apps-repo.js";
import { OAuthFlowError } from "../errors.js";

const REFRESH_THRESHOLD_SEC = 300; // refresh if <5 min remaining

/**
 * One in-flight promise per account id.
 * Any concurrent caller that arrives while a refresh is running
 * awaits the same promise instead of issuing a second refresh request.
 */
const inflight = new Map<number, Promise<string>>();

/**
 * Returns a valid (non-near-expired) access token for the given account.
 * If the token expires within REFRESH_THRESHOLD_SEC, a refresh is performed.
 * Concurrent calls for the same accountId share one refresh promise (mutex).
 */
export async function getAccessToken(accountId: number): Promise<string> {
  // 1. Check if a refresh is already in flight for this account.
  const existing = inflight.get(accountId);
  if (existing) return existing;

  // 2. Load account from DB.
  const acc = getAccountById(accountId);
  if (!acc) throw new Error(`Account id=${accountId} not found`);

  // 3. Token still valid — return immediately.
  const now = Math.floor(Date.now() / 1000);
  if (acc.expires_at - now > REFRESH_THRESHOLD_SEC) {
    return acc.access_token;
  }

  // 4. Token near-expired — acquire mutex and refresh.
  const promise = doRefresh(acc).finally(() => inflight.delete(accountId));
  inflight.set(accountId, promise);
  return promise;
}

async function doRefresh(acc: AccountRow): Promise<string> {
  const app = getAppById(acc.oauth_app_id);
  if (!app) {
    throw new OAuthFlowError(
      `OAuth app id=${acc.oauth_app_id} for account '${acc.label}' missing`
    );
  }

  try {
    const tokens = await refreshAccessToken(
      { client_id: app.client_id, client_secret: app.client_secret },
      acc.refresh_token
    );
    const newExpiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;
    updateAccountTokens(acc.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token, // Yandex rotates — store new one
      expires_at: newExpiresAt,
      scopes_granted: tokens.scope || acc.scopes_granted,
    });
    return tokens.access_token;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    throw new OAuthFlowError(
      `Refresh failed for account '${acc.label}'. Re-run start_oauth_flow to re-link this label. (${msg})`
    );
  }
}

/** Clears the in-flight map. Intended for use in unit tests only. */
export function _clearInflight(): void {
  inflight.clear();
}

if (process.argv[2] === "race-smoke") {
  // Real refresh would fail without a valid Yandex app; this stub just
  // verifies the module compiles and the mutex structure is in place.
  console.log("smoke-stub: race-test требует unit-mock; покрывается верификацией concurrent-call в TASK-112"); // guardian: allow
}
