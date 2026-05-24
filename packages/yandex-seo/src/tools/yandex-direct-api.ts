import { executeApiCall, type ExecuteResult } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

/**
 * Generic Yandex Direct API gateway.
 *
 * IMPORTANT — `body` vs `params`:
 * - Yandex Direct API v5 is POST-only. Pass Direct's request payload (with its own
 *   `method` and nested `params`) in the `body` field of this tool.
 * - The `params` field of this tool is for URL query string (rarely used with Direct).
 *
 * Correct usage example:
 *   {
 *     endpoint: "/json/v5/campaigns",
 *     body: {
 *       method: "get",
 *       params: {
 *         SelectionCriteria: {},
 *         FieldNames: ["Id", "Name"],
 *         Page: { Limit: 50 }
 *       }
 *     }
 *   }
 *
 * For convenience, if you accidentally put a Direct-shaped payload (containing `method`
 * key) in the `params` field of this tool while using POST/PUT, the gateway will
 * auto-promote it to `body` and add a `_note` to the response.
 *
 * If Direct returns error_code 8000 (cannot parse JSON/XML), the gateway adds a `_hint`
 * to the response explaining the fix.
 *
 * DANGER operations (add, update, delete, suspend, resume, archive) are gated by
 * dedicated DANGER tools — do not rely on this gateway to block them.
 */
export async function runYandexDirectApi(input: {
  endpoint: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, unknown>;
  body?: unknown;
  account?: string;
  client_login?: string;
  force_refresh?: boolean;
}) {
  try {
    // Determine effective method (POST default for Direct)
    const effectiveMethod = input.method ?? "POST"; // Direct defaults to POST per gateway spec
    const isWrite = effectiveMethod === "POST" || effectiveMethod === "PUT";

    let body = input.body;
    let urlParams = input.params;
    let autoPromoted = false;

    if (isWrite && body === undefined && input.params && typeof input.params === "object") {
      const p = input.params as Record<string, unknown>;
      // Heuristic: if params contains `method` (e.g. "get", "add") OR a nested `params` → it's a Direct payload
      if ("method" in p || "params" in p) {
        body = input.params;
        urlParams = undefined;
        autoPromoted = true;
      }
    }

    const result = await executeApiCall({
      apiName: "direct",
      endpoint: input.endpoint,
      method: input.method,
      params: urlParams,
      body,
      account: input.account,
      client_login: input.client_login,
      force_refresh: input.force_refresh,
    });

    // After result returned, check for Direct-side parse error
    let hint: string | undefined;
    // For ok:false the error body is in result.body; for ok:true check result.data
    const candidateErrBody: unknown = result.ok ? result.data : result.body;
    if (candidateErrBody && typeof candidateErrBody === "object" && "error" in candidateErrBody) {
      const errContainer = candidateErrBody as Record<string, unknown>;
      const err = errContainer["error"];
      if (err && typeof err === "object" && "error_code" in err) {
        const code = (err as Record<string, unknown>)["error_code"];
        if (code === 8000 || code === "8000") {
          hint =
            "Direct returned error 8000 (cannot parse JSON/XML). For Direct API POST calls, pass the request payload in the `body` field, NOT `params`. Example: { endpoint: '/json/v5/campaigns', body: { method: 'get', params: { SelectionCriteria: {}, FieldNames: ['Id'] } } }";
        }
      }
    }

    // Build augmented response — spread the typed result then add optional diagnostic fields
    const augmented: ExecuteResult & { _note?: string; _hint?: string } = { ...result };
    if (autoPromoted) {
      augmented._note =
        "Auto-promoted `params` field to `body` (POST method detected with Direct-shaped payload in params).";
    }
    if (hint) {
      augmented._hint = hint;
    }

    return { content: [{ type: "text" as const, text: JSON.stringify(augmented, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
