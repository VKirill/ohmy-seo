export class AuthError extends Error {
  constructor(public status: number) {
    super("Auth rejected");
    this.name = "AuthError";
  }
}

export class RateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Rate limited; retry after ${retryAfterSec}s`);
    this.name = "RateLimitError";
  }
}

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`API error ${status}`);
    this.name = "ApiError";
  }
}

/**
 * The provider sent no response within the request timeout, or the connection
 * failed before any HTTP status (reset, DNS, TLS). Both clear up on their own.
 * `attempts` counts the tries made; `readOnly` is false when a write may have
 * been applied despite the missing answer.
 */
export class TransientNetworkError extends Error {
  constructor(
    public kind: "timeout" | "network",
    public timeoutMs: number,
    public attempts = 1,
    public readOnly?: boolean,
  ) {
    super(kind === "timeout" ? `No response within ${timeoutMs} ms` : "Network error before any response");
    this.name = "TransientNetworkError";
  }
}

export class OAuthFlowError extends Error {
  constructor(message: string, public yandexError?: string) {
    super(message);
    this.name = "OAuthFlowError";
  }
}

export class AccountNotFoundError extends Error {
  constructor(label: string) {
    super(`Account '${label}' not found. Run list_accounts to see available labels.`);
    this.name = "AccountNotFoundError";
  }
}

export class AmbiguousSiteError extends Error {
  constructor(
    query: string,
    public candidates: Array<{
      kind: string;
      account_label: string;
      host_id?: string;
      counter_id?: string;
      display: string;
      score: number;
    }>
  ) {
    super(
      `Ambiguous match for '${query}'. ${candidates.length} candidates with equal score. ` +
        `Specify account or use direct host_id/counter_id. Candidates: ` +
        candidates.map((c) => c.display + "(" + c.account_label + ")").join(", ")
    );
    this.name = "AmbiguousSiteError";
  }
}

export class NoMatchingAccountError extends Error {
  constructor(scope: string, candidates: string[]) {
    const hint =
      candidates.length === 0
        ? "Register an account first: register_oauth_app → start_oauth_flow → complete_oauth_flow."
        : `Specify 'account' explicitly or set one as default. Candidates with scope '${scope}': ${candidates.join(", ")}`;
    super(`No matching account for scope '${scope}'. ${hint}`);
    this.name = "NoMatchingAccountError";
  }
}

export function sanitizeForOutput(text: string): string {
  return text
    .replace(/OAuth\s+[A-Za-z0-9._-]{8,}/g, "OAuth <redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/g, "Bearer <redacted>")
    .replace(/\/json\/[a-f0-9]{16,}\b/gi, "/json/<redacted>")
    .replace(/"access_token"\s*:\s*"[^"]*"/g, '"access_token": "<redacted>"')
    .replace(/"refresh_token"\s*:\s*"[^"]*"/g, '"refresh_token": "<redacted>"')
    .replace(/"client_secret"\s*:\s*"[^"]*"/g, '"client_secret": "<redacted>"')
    .replace(/client_secret=[^&\s]+/g, "client_secret=<redacted>")
    .replace(/\bcode=[A-Za-z0-9_-]{4,}\b/g, "code=<redacted>");
}

type McpErrorResult = {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
};

export function errorToMcpContent(err: unknown): McpErrorResult {
  let text: string;

  if (err instanceof AuthError) {
    text =
      "Authentication failed (HTTP " +
      err.status +
      "). Re-run start_oauth_flow to reconnect the account, or use delete_account and re-link.";
  } else if (err instanceof RateLimitError) {
    text = "Rate limited. Wait " + err.retryAfterSec + " seconds before retrying.";
  } else if (err instanceof TransientNetworkError) {
    const what =
      err.kind === "timeout"
        ? `The API did not respond within ${Math.round(err.timeoutMs / 1000)} s`
        : "The connection to the API failed before any response";
    const advice =
      err.readOnly === false
        ? "This was a write: check whether it was applied before repeating it."
        : "Repeat the request in a minute.";
    text = JSON.stringify({
      ok: false,
      error: err.kind,
      retryable: true,
      timeout_ms: err.timeoutMs,
      attempts: err.attempts,
      message: `${what} (${err.attempts} attempt${err.attempts === 1 ? "" : "s"}). ${advice}`,
    });
  } else if (err instanceof ApiError) {
    text =
      "API error " +
      err.status +
      ". Body: " +
      sanitizeForOutput(err.body).slice(0, 500);
  } else {
    text =
      "Unexpected error: " +
      sanitizeForOutput(String(err)).slice(0, 500);
  }

  return { isError: true, content: [{ type: "text", text }] };
}

if (process.argv[2] === "smoke") {
  const cases = [
    'OAuth y0_AgAAAAB123456789abc',
    '{"access_token":"y0_xyz","refresh_token":"1:foo"}',
    'client_secret=topsecret123&grant_type=...',
    'code=ab12cd34 used',
  ];
  for (const c of cases) console.log("BEFORE:", c, "\nAFTER: ", sanitizeForOutput(c));
}
