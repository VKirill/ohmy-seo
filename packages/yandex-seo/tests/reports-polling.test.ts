import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/account-resolver.js", () => ({ resolveAccount: () => ({ id: 1 }) }));
vi.mock("../src/lib/oauth/token-broker.js", () => ({ getAccessToken: async () => "token" }));
vi.mock("../src/lib/api/endpoints-spec.js", () => ({
  getApiSpec: () => ({ baseUrl: "https://api.direct.test", requiredScope: "direct" }),
}));

const { pollReport, parseReportError, isTransientReportFailure } = await import("../src/lib/api/reports-polling.js");
const { searchTermsReportName } = await import("../src/tools/direct-get-search-terms.js");

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

const poll = () => pollReport({ body: { params: {} }, retryDelaysMs: [1, 1, 1], pollIntervalMs: 1 });
const building = (retryIn?: string) =>
  new Response("", { status: 201, headers: retryIn ? { retryIn } : {} });

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

  it("waits through 201/202 and error 56, then returns the report", async () => {
    const fetch = mockFetch(
      building("2"),
      new Response(directError(56), { status: 400 }),
      new Response("", { status: 202 }),
      new Response(TSV, { status: 200 }),
    );
    const result = await pollReport({
      body: { params: { ReportName: "r-56" } },
      pollIntervalMs: 5,
      maxWaitMs: 10_000,
    });
    expect(result).toMatchObject({ ok: true, attempts: 4, report_name: "r-56", rows: [{ CampaignId: "123" }] });
    expect(fetch).toHaveBeenCalledTimes(4);
    // The same report is requested every time, never a fresh one.
    for (const call of fetch.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(JSON.parse(call[1].body as string).params.ReportName).toBe("r-56");
    }
  });

  it("keeps at least the poll interval between requests for one report", async () => {
    const times: number[] = [];
    const responses = [building("1"), new Response(directError(56), { status: 400 }), new Response(TSV, { status: 200 })];
    vi.stubGlobal("fetch", vi.fn(async () => { times.push(Date.now()); return responses.shift()!; }));
    // retryIn of 1 s is honoured; the 56 retry still waits the full interval.
    const result = await pollReport({ body: { params: {} }, pollIntervalMs: 300, maxWaitMs: 10_000 });
    expect(result.ok).toBe(true);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(990);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(290);
  });

  it("returns pending with the report name when the budget runs out", async () => {
    const fetch = mockFetch(building(), new Response(directError(56), { status: 400 }));
    const result = await pollReport({ body: { params: { ReportName: "slow" } }, pollIntervalMs: 40, maxWaitMs: 60 });
    expect(result).toMatchObject({ ok: false, pending: true, report_name: "slow", error_code: 56, retry_after_ms: 40, attempts: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("searchTermsReportName", () => {
  const params = { ReportType: "SEARCH_QUERY_PERFORMANCE_REPORT", DateRangeType: "YESTERDAY", FieldNames: ["Query"] };
  const now = new Date("2026-10-22T09:00:00Z");

  it("is stable for the same request and differs for another one", () => {
    const name = searchTermsReportName(params, undefined, now);
    expect(name).toMatch(/^search-terms-[0-9a-f]{16}$/);
    expect(searchTermsReportName({ ...params }, undefined, new Date("2026-10-22T19:00:00Z"))).toBe(name);
    expect(searchTermsReportName({ ...params, FieldNames: ["Query", "Clicks"] }, undefined, now)).not.toBe(name);
    expect(searchTermsReportName(params, "sub-client", now)).not.toBe(name);
    // Next Moscow day (21:00 UTC = 00:00 MSK) — a fresh report.
    expect(searchTermsReportName(params, undefined, new Date("2026-10-22T21:00:00Z"))).not.toBe(name);
  });
});
