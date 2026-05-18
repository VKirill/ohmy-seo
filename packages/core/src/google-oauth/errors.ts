/**
 * Google OAuth / API error classification.
 * Handles two JSON error shapes:
 *   - Token endpoint: {error: 'invalid_grant', error_description: '...'}
 *   - API endpoint:   {error: {code: N, message: '...', status: 'PERMISSION_DENIED'}}
 */

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorKind =
  | 'invalid_grant'
  | 'unauthorized'
  | 'forbidden'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'server_error'
  | 'other';

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
  re_auth_required: boolean;
  retryable: boolean;
  status?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Attempt to parse an unknown value as JSON if it is a string. */
function tryParseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value;
}

function makeResult(
  kind: ErrorKind,
  message: string,
  status?: number
): ClassifiedError {
  const re_auth_required = kind === 'invalid_grant';
  const retryable = kind === 'rate_limited' || kind === 'server_error';
  return { kind, message, re_auth_required, retryable, ...(status !== undefined ? { status } : {}) };
}

// ---------------------------------------------------------------------------
// classifyGoogleError
// ---------------------------------------------------------------------------

/**
 * Classifies an error thrown by Google OAuth token or API endpoints.
 *
 * Accepts:
 *   - A fetch Response object (reads .status)
 *   - A plain object with a Google error body shape
 *   - An Error instance (wraps in 'other')
 *   - Any other value (wraps in 'other')
 */
export function classifyGoogleError(err: unknown): ClassifiedError {
  // --- Response object path ---
  if (
    err !== null &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as Record<string, unknown>)['status'] === 'number'
  ) {
    const status = (err as { status: number }).status;

    // Try to also extract a body if present (e.g. a pre-parsed body attached)
    const body = tryParseJson((err as Record<string, unknown>)['body']);
    const bodyResult = body ? classifyJsonBody(body, status) : null;
    if (bodyResult) return bodyResult;

    return classifyByStatus(status, `HTTP ${status}`);
  }

  // --- Plain object / parsed JSON body path ---
  if (err !== null && typeof err === 'object') {
    const bodyResult = classifyJsonBody(err, undefined);
    if (bodyResult) return bodyResult;
  }

  // --- Error instance path ---
  if (err instanceof Error) {
    // Attempt to extract a status code from the message
    const match = err.message.match(/HTTP\s+(\d{3})/);
    if (match) {
      const status = parseInt(match[1]!, 10);
      return classifyByStatus(status, err.message);
    }
    return makeResult('other', err.message);
  }

  // --- Fallback ---
  return makeResult('other', String(err));
}

// ---------------------------------------------------------------------------
// Internal classifiers
// ---------------------------------------------------------------------------

function classifyByStatus(status: number, message: string): ClassifiedError {
  if (status === 401) return makeResult('unauthorized', message, status);
  if (status === 403) return makeResult('forbidden', message, status);
  if (status === 429) return makeResult('rate_limited', message, status);
  if (status >= 500 && status <= 503) return makeResult('server_error', message, status);
  return makeResult('other', message, status);
}

/**
 * Tries to classify from a parsed JSON body.
 * Returns null if the body doesn't match a known Google error shape.
 */
function classifyJsonBody(
  body: unknown,
  statusHint: number | undefined
): ClassifiedError | null {
  if (body === null || typeof body !== 'object') return null;

  const obj = body as Record<string, unknown>;

  // Shape 1: token endpoint — {error: 'invalid_grant', error_description: '...'}
  if (typeof obj['error'] === 'string') {
    const errCode = obj['error'] as string;
    const desc = typeof obj['error_description'] === 'string'
      ? obj['error_description']
      : errCode;

    if (errCode === 'invalid_grant') {
      return makeResult('invalid_grant', desc, statusHint);
    }
    if (errCode === 'unauthorized_client' || errCode === 'access_denied') {
      return makeResult('unauthorized', desc, statusHint);
    }
    // Generic string error from token endpoint — map by status if available
    if (statusHint !== undefined) {
      return classifyByStatus(statusHint, desc);
    }
    return makeResult('other', desc, statusHint);
  }

  // Shape 2: API endpoint — {error: {code: N, message: '...', status: 'PERMISSION_DENIED'}}
  if (obj['error'] !== null && typeof obj['error'] === 'object') {
    const apiErr = obj['error'] as Record<string, unknown>;
    const code = typeof apiErr['code'] === 'number' ? apiErr['code'] : statusHint;
    const msg = typeof apiErr['message'] === 'string'
      ? apiErr['message']
      : `HTTP ${code ?? 'unknown'}`;
    const apiStatus = typeof apiErr['status'] === 'string' ? apiErr['status'] : '';

    // API-level status string takes precedence
    if (apiStatus === 'PERMISSION_DENIED') return makeResult('forbidden', msg, code);
    if (apiStatus === 'RESOURCE_EXHAUSTED') return makeResult('quota_exceeded', msg, code);
    if (apiStatus === 'UNAUTHENTICATED') return makeResult('unauthorized', msg, code);
    if (apiStatus === 'UNAVAILABLE') return makeResult('server_error', msg, code);

    // Fall back to HTTP code
    if (code !== undefined) return classifyByStatus(code, msg);
    return makeResult('other', msg);
  }

  return null;
}
