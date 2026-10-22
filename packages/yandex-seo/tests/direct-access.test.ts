import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Throwaway state.db: the access-block table must never touch a developer's data/state.db.
process.env.MCP_YANDEX_SEO_DB_PATH = join(mkdtempSync(join(tmpdir(), "direct-access-")), "state.db");

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
// executeApiCall goes through core's undici-based request(); route it to the same stubbed fetch.
vi.mock("@ohmy-seo/mcp-core/http", async () => {
  const { ApiError } = await import("@ohmy-seo/mcp-core/errors");
  return {
    request: async (url: string, init?: RequestInit) => {
      const response = await (globalThis.fetch as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
      const text = await response.text();
      if (response.status >= 400) throw new ApiError(response.status, text);
      return { status: response.status, data: text ? JSON.parse(text) : undefined, headers: {} };
    },
  };
});

const { executeApiCall } = await import("../src/lib/api-gateway.js");
const { pollReport } = await import("../src/lib/api/reports-polling.js");
const { getDb } = await import("@ohmy-seo/mcp-core/db");
const { listDirectAccessBlocks } = await import("../src/lib/api/direct-access.js");
listDirectAccessBlocks(); // creates the table

const directError = (code: number, detail = "detail") =>
  JSON.stringify({ error: { request_id: "r1", error_code: code, error_string: "err", error_detail: detail } });
const json = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
const campaigns = () => json(JSON.stringify({ result: { Campaigns: [{ Id: 1 }] } }));

function mockFetch(...responses: Response[]) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    return next;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const listCampaigns = (extra: { client_login?: string; force_refresh?: boolean } = {}) =>
  executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/campaigns",
    method: "POST",
    body: { method: "get", params: { SelectionCriteria: {}, FieldNames: ["Id"] } },
    ...extra,
  });

beforeEach(() => getDb().exec("DELETE FROM direct_access_blocks"));
afterEach(() => vi.unstubAllGlobals());

describe("executeApiCall — Direct errors in HTTP 200 bodies", () => {
  it("returns ok:false for a top-level Direct error", async () => {
    mockFetch(json(directError(8000, "Specify the user's login in the HTTP Client-Login header")));
    const result = await listCampaigns();
    expect(result).toMatchObject({ ok: false, status: 200, body: { error: { error_code: 8000 } } });
  });

  it("keeps ordinary results ok:true", async () => {
    mockFetch(campaigns());
    expect(await listCampaigns()).toMatchObject({ ok: true, data: { result: { Campaigns: [{ Id: 1 }] } } });
  });
});

describe("executeApiCall — blocked Direct logins", () => {
  it("stops calling a login after error 3000 until force_refresh", async () => {
    const fetch = mockFetch(json(directError(3000, "The user's account is blocked")));
    expect(await listCampaigns()).toMatchObject({ ok: false, body: { error: { error_code: 3000 } } });

    const skipped = await listCampaigns();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(skipped).toMatchObject({
      ok: false,
      status: 403,
      body: { skipped: true, error: { error_code: 3000, error_detail: "The user's account is blocked" } },
    });

    // force_refresh re-checks; success lifts the block.
    mockFetch(campaigns(), campaigns());
    expect(await listCampaigns({ force_refresh: true })).toMatchObject({ ok: true });
    expect(await listCampaigns()).toMatchObject({ ok: true });
  });

  it("blocks per client login, not the whole agency", async () => {
    mockFetch(json(directError(3000)), campaigns());
    await listCampaigns({ client_login: "blocked-client" });
    expect(await listCampaigns({ client_login: "other-client" })).toMatchObject({ ok: true });
    expect(await listCampaigns({ client_login: "blocked-client" })).toMatchObject({ ok: false, body: { skipped: true } });
  });

  it("does not block on errors that are about the request", async () => {
    const fetch = mockFetch(json(directError(8000)), campaigns());
    await listCampaigns();
    expect(await listCampaigns()).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("re-checks once the window has passed", async () => {
    mockFetch(json(directError(513)));
    await listCampaigns();
    getDb().exec(`UPDATE direct_access_blocks SET blocked_at = blocked_at - ${7 * 3600}`);
    mockFetch(campaigns());
    expect(await listCampaigns()).toMatchObject({ ok: true });
  });
});

describe("pollReport — blocked Direct logins", () => {
  const poll = (forceRecheck?: boolean) => pollReport({ body: { params: { ReportName: "r" } }, pollIntervalMs: 1, forceRecheck });

  it("records a 3000 from Reports and skips the next report", async () => {
    const fetch = mockFetch(new Response(directError(3000), { status: 400 }));
    expect(await poll()).toMatchObject({ ok: false, error_code: 3000, attempts: 1 });
    expect(await poll()).toMatchObject({ ok: false, skipped: true, error_code: 3000, attempts: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);

    mockFetch(new Response("A\tB\n1\t2\n", { status: 200 }));
    expect(await poll(true)).toMatchObject({ ok: true, rows: [{ A: "1", B: "2" }] });
  });
});
