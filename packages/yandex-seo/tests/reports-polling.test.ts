import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/account-resolver.js", () => ({ resolveAccount: () => ({ id: 1 }) }));
vi.mock("../src/lib/oauth/token-broker.js", () => ({ getAccessToken: async () => "token" }));
vi.mock("../src/lib/api/endpoints-spec.js", () => ({
  getApiSpec: () => ({ baseUrl: "https://api.direct.test", requiredScope: "direct" }),
}));

const { pollReport, parseReportError, isTransientReportFailure } = await import("../src/lib/api/reports-polling.js");

const TSV = "CampaignId\tClicks\n123\t7\n";
const directError = (code: number) =>
  JSON.stringify({ error: { request_id: "r1", error_code: code, error_string: "err", error_detail: "detail" } });

function mockFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const poll = () => pollReport({ body: { params: {} }, retryDelaysMs: [1, 1, 1] });

afterEach(() => vi.unstubAllGlobals());

describe("parseReportError", () => {
  it("extracts Direct's error_code from a JSON body", () => {
    expect(parseReportError(directError(9000)).error_code).toBe(9000);
  });

  it("keeps non-JSON bodies as text", () => {
    expect(parseReportError("<html>Bad Gateway</html>")).toEqual({ error: "<html>Bad Gateway</html>" });
  });
});

describe("isTransientReportFailure", () => {
  it("retries 5xx and Direct codes 52/1000/9000, not request errors", () => {
    expect(isTransientReportFailure(502)).toBe(true);
    expect(isTransientReportFailure(400, 9000)).toBe(true);
    expect(isTransientReportFailure(400, 52)).toBe(true);
    expect(isTransientReportFailure(400, 8000)).toBe(false);
    expect(isTransientReportFailure(400)).toBe(false);
  });
});

describe("pollReport", () => {
  it("retries a queue-limit error (9000) and then returns the report", async () => {
    const fetch = mockFetch(new Response(directError(9000), { status: 400 }), new Response(TSV, { status: 200 }));
    const result = await poll();
    expect(result).toMatchObject({ ok: true, attempts: 2, rows: [{ CampaignId: "123", Clicks: "7" }] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries 502 and network errors", async () => {
    mockFetch(new Response("bad gateway", { status: 502 }), new TypeError("fetch failed"), new Response(TSV, { status: 200 }));
    expect(await poll()).toMatchObject({ ok: true, attempts: 3 });
  });

  it("returns the parsed Direct error immediately for non-transient failures", async () => {
    const fetch = mockFetch(new Response(directError(8000), { status: 400 }));
    const result = await poll();
    expect(result).toMatchObject({ ok: false, status: 400, error_code: 8000, attempts: 1 });
    expect(result.error).toMatchObject({ error: { error_code: 8000 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports the last Direct error once retries are exhausted", async () => {
    mockFetch(...Array.from({ length: 4 }, () => new Response(directError(52), { status: 400 })));
    expect(await poll()).toMatchObject({ ok: false, status: 400, error_code: 52, attempts: 4 });
  });
});
