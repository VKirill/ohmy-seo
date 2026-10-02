/**
 * One-line diagnostics for failed tool calls. Only the tool name, timing and
 * provider status codes are logged — never arguments, response bodies or
 * tokens, which may carry tenant data.
 */

interface ToolResultLike {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
}

/** Pulls `status` / `error_code` out of a JSON tool payload, if present. */
export function failureCodes(result: unknown): string {
  const text = (result as ToolResultLike | undefined)?.content?.find((c) => c?.type === "text")?.text;
  if (!text) return "";
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { return ""; }
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  const nested = (p.error as { error?: { error_code?: unknown } } | undefined)?.error?.error_code;
  const parts: string[] = [];
  for (const [key, value] of [["status", p.status], ["error_code", p.error_code ?? nested]] as const) {
    if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) parts.push(`${key}=${value}`);
  }
  if (p.error === "timeout") parts.push("reason=timeout");
  return parts.join(" ");
}

export function logToolFailure(userId: number, name: string, startedAt: number, detail: string): void {
  const ms = Date.now() - startedAt;
  console.error(`[tool] user ${userId}: ${name} failed in ${ms}ms${detail ? ` (${detail})` : ""}`);
}

/** Error class and MCP code only: SDK messages can echo child output. */
export function exceptionCodes(e: unknown): string {
  if (!(e instanceof Error)) return "reason=non-error";
  const code = (e as { code?: unknown }).code;
  return `reason=${e.name}${typeof code === "number" ? ` code=${code}` : ""}`;
}
