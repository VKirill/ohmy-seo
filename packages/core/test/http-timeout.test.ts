import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "../src/http.js";
import { TransientNetworkError, errorToMcpContent } from "../src/errors.js";

let server: Server;
let base: string;

beforeAll(async () => {
  // /slow never answers; /ok answers at once.
  server = createServer((req, res) => {
    if (req.url === "/ok") res.end(JSON.stringify({ ok: 1 }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("request — timeouts and connection failures", () => {
  it("throws TransientNetworkError(timeout) instead of AbortError", async () => {
    const err = await request(`${base}/slow`, undefined, { timeoutMs: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(TransientNetworkError);
    expect(err).toMatchObject({ kind: "timeout", timeoutMs: 100 });
  });

  it("throws TransientNetworkError(network) when the connection is refused", async () => {
    const err = await request("http://127.0.0.1:1/", undefined, { timeoutMs: 2000 }).catch((e) => e);
    expect(err).toBeInstanceOf(TransientNetworkError);
    expect(err).toMatchObject({ kind: "network" });
  });

  it("still returns normal responses", async () => {
    expect(await request(`${base}/ok`, undefined, { timeoutMs: 2000 })).toMatchObject({ status: 200, data: { ok: 1 } });
  });
});

describe("errorToMcpContent — transient errors", () => {
  it("reports a timed-out read as retryable JSON", () => {
    const out = errorToMcpContent(new TransientNetworkError("timeout", 50_000, 2, true));
    expect(out.isError).toBe(true);
    const body = JSON.parse(out.content[0]!.text);
    expect(body).toMatchObject({ ok: false, error: "timeout", retryable: true, timeout_ms: 50_000, attempts: 2 });
    expect(body.message).toContain("50 s");
  });

  it("warns that a timed-out write may have been applied", () => {
    const body = JSON.parse(errorToMcpContent(new TransientNetworkError("timeout", 50_000, 1, false)).content[0]!.text);
    expect(body.message).toContain("check whether it was applied");
  });
});
