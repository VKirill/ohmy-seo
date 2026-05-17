import { createHash } from "node:crypto";

export function canonicalStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalStringify(obj[k])).join(",") + "}";
}

export function computeArgsHash(toolName: string, accountId: number | null, args: Record<string, unknown>): string {
  const { force_refresh: _ignored, ...rest } = args ?? {};
  const payload = { tool: toolName, account_id: accountId ?? null, args: rest };
  return createHash("sha256").update(canonicalStringify(payload)).digest("hex");
}

if (process.argv[2] === "smoke") {
  const h1 = computeArgsHash("X", 1, { a: 1, b: 2 });
  const h2 = computeArgsHash("X", 1, { b: 2, a: 1 });
  console.log(h1 === h2 ? "OK same-hash-different-order" : "FAIL same-hash-different-order"); // guardian: allow

  const h3 = computeArgsHash("X", 1, { a: 1, b: 2, force_refresh: true });
  console.log(h1 === h3 ? "OK force_refresh-stripped" : "FAIL force_refresh-stripped"); // guardian: allow

  const h4 = computeArgsHash("X", 1, { a: 1, b: 2, c: undefined });
  console.log(h1 === h4 ? "OK undefined-stripped" : "FAIL undefined-stripped"); // guardian: allow

  const h5 = computeArgsHash("X", null, { a: 1, b: 2 });
  console.log(h1 !== h5 ? "OK account_id-affects-hash" : "FAIL account_id-affects-hash"); // guardian: allow
}
