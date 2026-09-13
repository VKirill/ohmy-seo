import {
  getGoogleAccessToken,
  GoogleAuthError,
} from "@ohmy-seo/mcp-core/google-oauth";
import { request } from "@ohmy-seo/mcp-core/http";
import { ApiError, AuthError, RateLimitError } from "@ohmy-seo/mcp-core/errors";
import { getDb } from "@ohmy-seo/mcp-core/db";
import { decryptSecret } from "@ohmy-seo/mcp-core/crypto";
import { SCOPE_ADWORDS } from "@ohmy-seo/mcp-core/google-oauth";
import type { AccountRow } from "./account-resolver.js";

/** Bump manually when Google sunsets a version. */
export const ADS_API_VERSION = "v25";

const BASE = "https://googleads.googleapis.com";
const PKG_NAME = "google-ads";

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

/** Developer token from env. Throws with an actionable message when absent. */
export function developerToken(): string {
  const token = (process.env["GOOGLE_ADS_DEVELOPER_TOKEN"] ?? "").trim();
  if (!token) {
    throw new Error(
      "GOOGLE_ADS_DEVELOPER_TOKEN is not set. Take it from Google Ads " +
        "manager account -> Tools -> API Center and put it into packages/google-ads/.env",
    );
  }
  return token;
}

/** Manager account id used as login-customer-id fallback. Digits only. */
export function envLoginCustomerId(): string | undefined {
  const raw = (process.env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"] ?? "").trim();
  const id = digitsOnly(raw);
  return id.length > 0 ? id : undefined;
}

/** DANGER tools refuse to execute unless this is explicitly true. */
export function liveMutationsAllowed(): boolean {
  return (process.env["GOOGLE_ADS_ALLOW_LIVE_MUTATIONS"] ?? "").trim().toLowerCase() === "true";
}

export function digitsOnly(value: string | number): string {
  return String(value).replace(/\D/g, "");
}

// ---------------------------------------------------------------------------
// Error shaping
// ---------------------------------------------------------------------------

/** Substring of a Google error -> plain-language hint appended to the response. */
const ERROR_HINTS: Array<[string, string]> = [
  ["CUSTOMER_NOT_ENABLED", "Аккаунт деактивирован или ещё не активирован — это не проблема доступа."],
  ["USER_PERMISSION_DENIED", "Нет доступа к аккаунту. Проверьте привязку к MCC или передайте login_customer_id."],
  ["DEVELOPER_TOKEN_NOT_APPROVED", "Токен разработчика не одобрен для боевых аккаунтов — нужен Basic access."],
  ["INVALID_DEVELOPER_TOKEN", "Неверный developer token. Сверьте значение в Центре API."],
  ["UNRECOGNIZED_FIELD", "Поле не существует в этом ресурсе. Вызовите ads_resource_metadata."],
  ["EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE", "Ресурс требует своё primary-поле в SELECT (например search_term_view.search_term)."],
  ["PROHIBITED_METRIC_IN_SELECT_OR_WHERE_CLAUSE", "Эта метрика несовместима с выбранным ресурсом."],
  ["DATE_RANGE_TOO_WIDE", "Слишком широкий период — сузьте диапазон дат."],
  ["REQUESTED_METRICS_FOR_MANAGER", "Метрики нельзя запрашивать у управляющего аккаунта, только у клиентского."],
  ["RESOURCE_EXHAUSTED", "Исчерпана квота операций. Explorer — 2880 операций в сутки."],
];

export interface AdsFailure {
  error_code: string;
  message: string;
  trigger?: unknown;
}

export interface AdsErrorPayload {
  status: number;
  google_status?: string;
  message?: string;
  errors: AdsFailure[];
  request_id?: string;
  hints: string[];
}

/** Parses a GoogleAdsFailure body (object or searchStream array) into a flat shape. */
export function parseAdsError(status: number, body: unknown): AdsErrorPayload {
  let parsed: unknown = body;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { status, message: parsed as string, errors: [], hints: [] };
    }
  }
  if (Array.isArray(parsed)) parsed = parsed[0];

  const err = (parsed as { error?: Record<string, unknown> } | undefined)?.error;
  const details = (err?.["details"] as Array<Record<string, unknown>> | undefined) ?? [];

  const errors: AdsFailure[] = [];
  let requestId: string | undefined;
  for (const detail of details) {
    if (typeof detail["requestId"] === "string") requestId = detail["requestId"];
    const list = (detail["errors"] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const item of list) {
      const codeObj = (item["errorCode"] ?? {}) as Record<string, unknown>;
      const code = Object.values(codeObj)[0];
      errors.push({
        error_code: typeof code === "string" ? code : JSON.stringify(codeObj),
        message: String(item["message"] ?? ""),
        ...(item["trigger"] !== undefined ? { trigger: item["trigger"] } : {}),
      });
    }
  }

  const haystack = JSON.stringify(parsed ?? "");
  const hints = ERROR_HINTS.filter(([needle]) => haystack.includes(needle)).map(([, hint]) => hint);

  return {
    status,
    ...(typeof err?.["status"] === "string" ? { google_status: err["status"] as string } : {}),
    ...(typeof err?.["message"] === "string" ? { message: err["message"] as string } : {}),
    errors,
    ...(requestId !== undefined ? { request_id: requestId } : {}),
    hints,
  };
}

function isPermissionProblem(payload: AdsErrorPayload): boolean {
  if (payload.status !== 403 && payload.google_status !== "PERMISSION_DENIED") return false;
  return !payload.errors.some((e) => e.error_code === "CUSTOMER_NOT_ENABLED");
}

// ---------------------------------------------------------------------------
// Micro-currency enrichment
// ---------------------------------------------------------------------------

/**
 * Walks a parsed response and adds `<field>_readable` next to every `*Micros`
 * field, so the model never divides by a million in its head.
 */
/**
 * Metrics that Google returns in micros without saying so in the field name.
 * Without this the model reads averageCpc = 17791512 and calls it 17 million.
 */
const MICRO_FIELDS = new Set([
  "averageCpc", "average_cpc",
  "averageCpm", "average_cpm",
  "averageCpv", "average_cpv",
  "costPerConversion", "cost_per_conversion",
  "costPerAllConversions", "cost_per_all_conversions",
  "costPerCurrentModelAttributedConversion", "cost_per_current_model_attributed_conversion",
]);


export function enrichMicros(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(enrichMicros);
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = enrichMicros(raw);
    if (/[Mm]icros$/.test(key) || MICRO_FIELDS.has(key)) {
      const num = Number(raw);
      if (Number.isFinite(num)) {
        const snake = key.includes("_");
        const base = key.replace(/_?[Mm]icros$/, "");
        out[base + (snake ? "_readable" : "Readable")] = Math.round(num / 10_000) / 100;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTTP call
// ---------------------------------------------------------------------------

export interface AdsCallParams {
  account: AccountRow;
  method: "GET" | "POST";
  /** Path after the version segment, e.g. `customers/123/googleAds:searchStream`. */
  path: string;
  body?: object;
  /** Explicit manager account for the login-customer-id header. */
  loginCustomerId?: string;
  /** Retry once through the manager account from env on a permission error. */
  managerFallback?: boolean;
}

export interface AdsCallResult {
  ok: boolean;
  status: number;
  data: unknown;
  /** Manager account actually used, when one was. */
  login_customer_id?: string;
}

export async function executeAdsCall(params: AdsCallParams): Promise<AdsCallResult> {
  const explicit = params.loginCustomerId ? digitsOnly(params.loginCustomerId) : undefined;
  const fallback = params.managerFallback === false ? undefined : envLoginCustomerId();

  const attempts: Array<string | undefined> = [explicit];
  if (explicit === undefined && fallback !== undefined) attempts.push(fallback);

  let last: AdsCallResult | undefined;
  for (const loginCustomerId of attempts) {
    const result = await callOnce(params, loginCustomerId);
    if (result.ok) return result;
    last = result;
    const payload = result.data as AdsErrorPayload;
    if (!isPermissionProblem(payload)) return result;
  }
  return last as AdsCallResult;
}

async function callOnce(
  params: AdsCallParams,
  loginCustomerId: string | undefined,
): Promise<AdsCallResult> {
  const { account, method, path, body } = params;

  const granted = (account.scopes_granted ?? "").split(" ").filter(Boolean);
  if (!granted.includes(SCOPE_ADWORDS)) {
    throw new Error(
      `Account "${account.label}" is missing the "${SCOPE_ADWORDS}" scope. ` +
        "Re-authorize via start_google_oauth_flow.",
    );
  }

  let app: { client_id: string; client_secret: string } | undefined;
  if (account.auth_method === "oauth_user" && account.oauth_app_id != null) {
    const appRow = findOAuthAppById(PKG_NAME, account.oauth_app_id);
    if (!appRow) {
      throw new GoogleAuthError(
        `OAuth app id=${account.oauth_app_id} not found for account "${account.label}"`,
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
    app,
  );

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": developerToken(),
    "Content-Type": "application/json",
  };
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

  const url = `${BASE}/${ADS_API_VERSION}/${path}`;
  const init = {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  } as Parameters<typeof request>[1];

  const fire = async (): Promise<AdsCallResult> => {
    const response = await request(url, init);
    return {
      ok: true,
      status: response.status,
      data: response.data,
      ...(loginCustomerId !== undefined ? { login_customer_id: loginCustomerId } : {}),
    };
  };

  try {
    return await fire();
  } catch (err) {
    // One retry on rate limiting, then give up with a clear message.
    if (err instanceof RateLimitError) {
      const waitMs = Math.min(err.retryAfterSec, 30) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      try {
        return await fire();
      } catch (again) {
        return failure(again, loginCustomerId);
      }
    }
    return failure(err, loginCustomerId);
  }
}

function failure(err: unknown, loginCustomerId: string | undefined): AdsCallResult {
  if (err instanceof AuthError) {
    return {
      ok: false,
      status: err.status,
      data: {
        status: err.status,
        google_status: "UNAUTHENTICATED",
        errors: [],
        hints: ["Токен доступа отвергнут. Пройдите start_google_oauth_flow заново."],
      } satisfies AdsErrorPayload,
    };
  }
  if (err instanceof ApiError) {
    return {
      ok: false,
      status: err.status,
      data: parseAdsError(err.status, err.body),
      ...(loginCustomerId !== undefined ? { login_customer_id: loginCustomerId } : {}),
    };
  }
  if (err instanceof RateLimitError) {
    return {
      ok: false,
      status: 429,
      data: {
        status: 429,
        errors: [],
        hints: ["Квота исчерпана даже после повтора. Explorer — 2880 операций в сутки."],
      } satisfies AdsErrorPayload,
    };
  }
  throw err;
}

// ---------------------------------------------------------------------------
// GAQL helper
// ---------------------------------------------------------------------------

export interface AdsSearchResult {
  ok: boolean;
  status: number;
  /** Flattened rows from every searchStream chunk. */
  rows?: unknown[];
  row_count?: number;
  error?: unknown;
  login_customer_id?: string;
}

/** Runs a GAQL query through googleAds:searchStream and flattens the chunks. */
export async function adsSearch(
  account: AccountRow,
  customerId: string,
  query: string,
  loginCustomerId?: string,
): Promise<AdsSearchResult> {
  const cid = digitsOnly(customerId);
  const result = await executeAdsCall({
    account,
    method: "POST",
    path: `customers/${cid}/googleAds:searchStream`,
    body: { query },
    ...(loginCustomerId !== undefined ? { loginCustomerId } : {}),
  });

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.data,
      ...(result.login_customer_id !== undefined
        ? { login_customer_id: result.login_customer_id }
        : {}),
    };
  }

  const chunks = Array.isArray(result.data) ? result.data : [result.data];
  const rows: unknown[] = [];
  for (const chunk of chunks) {
    const list = (chunk as { results?: unknown[] } | undefined)?.results;
    if (Array.isArray(list)) rows.push(...list);
  }

  return {
    ok: true,
    status: result.status,
    rows: enrichMicros(rows) as unknown[],
    row_count: rows.length,
    ...(result.login_customer_id !== undefined
      ? { login_customer_id: result.login_customer_id }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type AppSecretRow = { client_id: string; client_secret_enc: Buffer };

function findOAuthAppById(
  pkg: string,
  id: number,
): { client_id: string; client_secret: string } | null {
  const db = getDb(pkg);
  const row = db
    .prepare<[number], AppSecretRow>(
      `SELECT client_id, client_secret_enc FROM google_oauth_apps WHERE id = ?`,
    )
    .get(id);
  if (!row) return null;
  return { client_id: row.client_id, client_secret: decryptSecret(row.client_secret_enc) };
}
