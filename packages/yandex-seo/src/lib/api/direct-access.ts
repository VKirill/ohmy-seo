import { getDb } from "@ohmy-seo/mcp-core/db";

/**
 * Direct codes meaning the login itself cannot use the API, whatever the
 * request: 3000 — no access to API (account blocked, API access denied),
 * 513 — login not connected to Direct. Retrying will not help until the
 * cabinet is fixed, so further calls for that login are skipped for a while.
 */
const ACCESS_DENIED_CODES = new Set([3000, 513]);
/** Re-check a blocked login once per this window; `force_refresh` re-checks at once. */
export const DIRECT_BLOCK_RECHECK_S = 6 * 3600;

export interface DirectApiError {
  error_code?: number;
  error_string?: string;
  error_detail?: string;
}

export interface DirectAccessBlock {
  account_id: number;
  client_login: string;  // "" — the account's own cabinet
  error_code: number;
  error_string: string;
  error_detail: string;
  blocked_at: number;  // unix seconds
  recheck_after: number;  // unix seconds
}

let tableReady = false;

function db() {
  const conn = getDb();
  if (!tableReady) {
    conn.exec(`CREATE TABLE IF NOT EXISTS direct_access_blocks (
      account_id    INTEGER NOT NULL,
      client_login  TEXT NOT NULL DEFAULT '',
      error_code    INTEGER NOT NULL,
      error_string  TEXT NOT NULL DEFAULT '',
      error_detail  TEXT NOT NULL DEFAULT '',
      blocked_at    INTEGER NOT NULL,
      PRIMARY KEY (account_id, client_login)
    )`);
    tableReady = true;
  }
  return conn;
}

const now = () => Math.floor(Date.now() / 1000);

/** The top-level `{error}` Direct puts in an HTTP 200 body for request-level failures. */
export function directBodyError(data: unknown): DirectApiError | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const err = (data as { error?: unknown }).error;
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  const code = Number(e.error_code);
  if (!Number.isFinite(code)) return undefined;
  return {
    error_code: code,
    error_string: e.error_string === undefined ? undefined : String(e.error_string),
    error_detail: e.error_detail === undefined ? undefined : String(e.error_detail),
  };
}

export function isDirectAccessDenied(code: number | undefined): boolean {
  return code !== undefined && ACCESS_DENIED_CODES.has(code);
}

/** Active block for this login, or undefined once the re-check window has passed. */
export function getDirectAccessBlock(accountId: number, clientLogin?: string): DirectAccessBlock | undefined {
  try {
    const row = db()
      .prepare(
        `SELECT account_id, client_login, error_code, error_string, error_detail, blocked_at
         FROM direct_access_blocks WHERE account_id = ? AND client_login = ?`,
      )
      .get(accountId, clientLogin ?? "") as Omit<DirectAccessBlock, "recheck_after"> | undefined;
    if (!row) return undefined;
    const recheck_after = row.blocked_at + DIRECT_BLOCK_RECHECK_S;
    return recheck_after > now() ? { ...row, recheck_after } : undefined;
  } catch {
    // The guard only saves requests; a broken table must never stop a real call.
    return undefined;
  }
}

/** Remember an access-denied answer; ignores every other error code. */
export function recordDirectResult(accountId: number, clientLogin: string | undefined, error: DirectApiError | undefined): void {
  try {
    if (error && isDirectAccessDenied(error.error_code)) {
      db()
        .prepare(
          `INSERT INTO direct_access_blocks (account_id, client_login, error_code, error_string, error_detail, blocked_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, client_login) DO UPDATE SET
             error_code = excluded.error_code, error_string = excluded.error_string,
             error_detail = excluded.error_detail, blocked_at = excluded.blocked_at`,
        )
        .run(accountId, clientLogin ?? "", error.error_code, error.error_string ?? "", error.error_detail ?? "", now());
    } else if (!error) {
      // A successful call proves access is back (e.g. a force_refresh re-check).
      db().prepare(`DELETE FROM direct_access_blocks WHERE account_id = ? AND client_login = ?`).run(accountId, clientLogin ?? "");
    }
  } catch {
    // Same as above: best effort only.
  }
}

/** Every login still inside its re-check window, for list_accounts. */
export function listDirectAccessBlocks(): DirectAccessBlock[] {
  try {
    const rows = db()
      .prepare(
        `SELECT account_id, client_login, error_code, error_string, error_detail, blocked_at
         FROM direct_access_blocks WHERE blocked_at > ? ORDER BY account_id, client_login`,
      )
      .all(now() - DIRECT_BLOCK_RECHECK_S) as Array<Omit<DirectAccessBlock, "recheck_after">>;
    return rows.map((row) => ({ ...row, recheck_after: row.blocked_at + DIRECT_BLOCK_RECHECK_S }));
  } catch {
    return [];
  }
}

/** Error body returned instead of calling Direct for a blocked login; mirrors Direct's own shape. */
export function blockedDirectBody(block: DirectAccessBlock) {
  return {
    error: {
      error_code: block.error_code,
      error_string: block.error_string,
      error_detail: block.error_detail,
    },
    skipped: true,
    blocked_since: new Date(block.blocked_at * 1000).toISOString(),
    recheck_after: new Date(block.recheck_after * 1000).toISOString(),
    note:
      `Not sent: Direct denied API access for this ${block.client_login ? `client login '${block.client_login}'` : "account"} ` +
      `(error ${block.error_code}). Calls are skipped until recheck_after; fix access in the Direct cabinet, ` +
      `then pass force_refresh: true to yandex_direct_api to re-check now.`,
  };
}
