import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.MCP_YANDEX_SEO_DB_PATH = join(mkdtempSync(join(tmpdir(), "direct-timeout-")), "state.db");

vi.mock("../src/lib/account-resolver.js", () => ({ resolveAccount: () => ({ id: 7 }) }));
vi.mock("../src/lib/oauth/token-broker.js", () => ({ getAccessToken: async () => "token" }));
vi.mock("../src/lib/api/endpoints-spec.js", () => ({
  getApiSpec: () => ({
    baseUrl: "https://api.direct.test",
    requiredScope: "direct",
    authPrefix: "Bearer",
    defaultMethod: "POST",
    supportsClientLogin: true,
  }),
}));

// Each call pops the next outcome: an Error is thrown, anything else is the response data.
const outcomes: unknown[] = [];
const request = vi.fn(async (_url: string, _init?: unknown, _opts?: { timeoutMs?: number }) => {
  const next = outcomes.shift();
  if (next instanceof Error) throw next;
  return { status: 200, data: next, headers: {} };
});
vi.mock("@ohmy-seo/mcp-core/http", () => ({ request }));

const { TransientNetworkError } = await import("@ohmy-seo/mcp-core/errors");
const { executeApiCall, isDirectRead } = await import("../src/lib/api-gateway.js");
const { runYandexDirectApi } = await import("../src/tools/yandex-direct-api.js");

const timeout = () => new TransientNetworkError("timeout", 50_000);
const keywordbidsGet = {
  method: "get",
  params: {
    SelectionCriteria: { CampaignIds: [1], ServingStatuses: ["ELIGIBLE"] },
    FieldNames: ["KeywordId", "CampaignId"],
    SearchFieldNames: ["Bid", "AuctionBids"],
  },
};
const call = (body: unknown) =>
  executeApiCall({ apiName: "direct", endpoint: "/json/v5/keywordbids", method: "POST", body });

beforeEach(() => {
  outcomes.length = 0;
  request.mockClear();
});

describe("executeApiCall — Direct timeouts", () => {
  it("retries a timed-out read once and returns the second answer", async () => {
    outcomes.push(timeout(), { result: { KeywordBids: [] } });
    expect(await call(keywordbidsGet)).toMatchObject({ ok: true, data: { result: { KeywordBids: [] } } });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]![2]).toEqual({ timeoutMs: 50_000 });
  });

  it("gives up after two timed-out reads with a retryable error", async () => {
    outcomes.push(timeout(), timeout());
    const err = await call(keywordbidsGet).catch((e) => e);
    expect(err).toBeInstanceOf(TransientNetworkError);
    expect(err).toMatchObject({ kind: "timeout", attempts: 2, readOnly: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("never resends a write", async () => {
    outcomes.push(timeout());
    const err = await call({ method: "set", params: { KeywordBids: [{ KeywordId: 1, SearchBid: 1 }] } }).catch((e) => e);
    expect(err).toMatchObject({ kind: "timeout", attempts: 1, readOnly: false });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("yandex_direct_api answers with retryable JSON, not 'Unexpected error: AbortError'", async () => {
    outcomes.push(timeout(), timeout());
    const out = await runYandexDirectApi({ endpoint: "/json/v5/keywordbids", method: "POST", body: keywordbidsGet });
    expect(out.isError).toBe(true);
    const text = out.content[0]!.text;
    expect(text).not.toContain("Unexpected error");
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: "timeout", retryable: true, attempts: 2 });
  });
});

describe("isDirectRead", () => {
  it.each([
    ["POST", { method: "get" }, true],
    ["POST", { method: "checkDictionaries" }, true],
    ["POST", { method: "hasSearchVolume" }, true],
    ["GET", undefined, true],
    ["POST", { method: "add" }, false],
    ["POST", { method: "set" }, false],
    ["POST", { method: "setAuto" }, false],
    ["POST", undefined, false],
  ])("%s %j → %s", (method, body, expected) => {
    expect(isDirectRead(method, body)).toBe(expected);
  });
});
