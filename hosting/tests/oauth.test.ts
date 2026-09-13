import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "../apps/web/node_modules/next/server.js";
import { signFlow, verifyFlow, type OAuthFlow } from "../apps/web/src/lib/oauth/state";
import { authorizeUrl } from "../apps/web/src/lib/oauth/index";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), session: vi.fn(), upsert: vi.fn(), stored: vi.fn(), exchange: vi.fn(),
  identity: vi.fn(), cookieDelete: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: mocks.cookieDelete }) }));
vi.mock("@/lib/session", () => ({ currentUser: mocks.user, createSession: mocks.session }));
vi.mock("@/lib/connections", () => ({ upsertConnection: mocks.upsert, hasStoredRefreshToken: mocks.stored }));
vi.mock("@/lib/oauth", async (original) => ({
  ...await original<any>(), exchangeCode: mocks.exchange,
  PROVIDERS: { yandex: { identity: mocks.identity }, "yandex-direct": { identity: mocks.identity }, google: { identity: mocks.identity } },
}));
import { GET as start } from "../apps/web/src/app/api/oauth/[provider]/start/route";
import { GET as callback } from "../apps/web/src/app/api/oauth/[provider]/callback/route";

const base: OAuthFlow = { provider: "yandex", userId: 10, chain: true, retried: false };
async function invoke(flow: OAuthFlow, query = "code=test-code") {
  const state = await signFlow(flow);
  const req = new NextRequest(`https://test.invalid/api/oauth/${flow.provider}/callback?${query}&state=${state}`, {
    headers: { cookie: `ohmy_state_${flow.provider}=${state}` },
  });
  return callback(req, { params: Promise.resolve({ provider: flow.provider }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.APP_URL = "https://test.invalid";
  process.env.YANDEX_CLIENT_ID = "test-yandex";
  process.env.YANDEX_DIRECT_CLIENT_ID = "test-direct";
  process.env.GOOGLE_CLIENT_ID = "test-google";
  mocks.user.mockResolvedValue({ id: 10 });
  mocks.upsert.mockResolvedValue({ userId: 10, connectionId: 42 });
  mocks.stored.mockResolvedValue(true);
  mocks.exchange.mockResolvedValue({ accessToken: "test-token", refreshToken: "test-refresh", expiresInSeconds: 3600, scope: "test" });
  mocks.identity.mockResolvedValue({ subject: "account-2", login: "second", email: "second@example.test", displayName: null });
});

describe("repeated account connections", () => {
  it("opens provider authorization directly for every add-account link", async () => {
    for (const provider of ["yandex", "google"]) {
      for (const query of ["?mode=connect", "?chain=1", "", "?mode=connect&login_hint=old@example.test"]) {
        const res = await start(new NextRequest(`https://test.invalid/api/oauth/${provider}/start${query}`), { params: Promise.resolve({ provider }) });
        const url = new URL(res.headers.get("location")!);
        expect(url.host).toBe(provider === "yandex" ? "oauth.yandex.ru" : "accounts.google.com");
        expect(url.searchParams.get("login_hint")).toBeNull();
        expect(url.searchParams.get(provider === "yandex" ? "force_confirm" : "prompt")).toBe(provider === "yandex" ? "yes" : "select_account");
        expect((await verifyFlow(url.searchParams.get("state")!, provider)).userId).toBe(10);
        expect(res.headers.get("set-cookie")).toContain(`ohmy_state_${provider}`);
      }
    }
  });
  it("first sign-in without a cabinet session still starts OAuth directly", async () => {
    mocks.user.mockResolvedValue(null);
    const res = await start(new NextRequest("https://test.invalid/api/oauth/yandex/start?chain=1"), { params: Promise.resolve({ provider: "yandex" }) });
    expect(new URL(res.headers.get("location")!).host).toBe("oauth.yandex.ru");
  });
  it("Google preserves selection on consent retry and requests offline access", () => {
    for (const retry of [false, true]) {
      const url = new URL(authorizeUrl("google", "state", retry));
      expect(url.searchParams.get("prompt")).toContain("select_account");
      expect(url.searchParams.get("access_type")).toBe("offline");
    }
  });
  it("requires a session when adding, instead of signing in as the new account", async () => {
    mocks.user.mockResolvedValue(null);
    const res = await start(new NextRequest("https://test.invalid/api/oauth/google/start?mode=connect"), { params: Promise.resolve({ provider: "google" }) });
    expect(res.headers.get("location")).toContain("session_required");
  });
  it("binds the Direct step to the NEW Yandex account, not the first account", async () => {
    const res = await invoke(base);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ userId: 10, identity: expect.objectContaining({ subject: "account-2" }) }));
    const url = new URL(res.headers.get("location")!);
    const flow = await verifyFlow(url.searchParams.get("state")!, "yandex-direct");
    expect(flow.expectedSubject).toBe("account-2");
    expect(url.searchParams.get("login_hint")).toBe("second");
  });
  it("stores each Direct account under its real identity", async () => {
    for (const subject of ["account-1", "account-2"]) {
      mocks.identity.mockResolvedValue({ subject, login: subject, email: null, displayName: null });
      await invoke({ ...base, provider: "yandex-direct", expectedSubject: subject });
    }
    expect(mocks.upsert.mock.calls.map(([x]) => x.identity.subject)).toEqual(["account-1", "account-2"]);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("rejects switching accounts on the Direct consent screen", async () => {
    const res = await invoke({ ...base, provider: "yandex-direct", expectedSubject: "account-1" });
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toContain("другой аккаунт");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("does not attach an account if the cabinet session was lost or switched", async () => {
    for (const user of [null, { id: 11 }]) {
      mocks.user.mockResolvedValue(user);
      await invoke(base);
    }
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("Google retries once, pinned to the selected identity and cabinet", async () => {
    mocks.exchange.mockResolvedValue({ accessToken: "test", refreshToken: null });
    mocks.stored.mockResolvedValue(false);
    const res = await invoke({ ...base, provider: "google", chain: false });
    const url = new URL(res.headers.get("location")!);
    const flow = await verifyFlow(url.searchParams.get("state")!, "google");
    expect(flow).toMatchObject({ userId: 10, expectedSubject: "account-2", retried: true });
    const second = await invoke(flow);
    expect(second.headers.get("location")).toContain("/app?error=");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("cancellation consumes state and saves no connection", async () => {
    await invoke(base, "error=access_denied");
    expect(mocks.cookieDelete).toHaveBeenCalledWith("ohmy_state_yandex");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("rejects wrong-provider or tampered signed state", async () => {
    const state = await signFlow(base);
    await expect(verifyFlow(state, "google")).rejects.toThrow();
    await expect(verifyFlow(state.slice(0, -8) + "tampered", "yandex")).rejects.toThrow();
  });
});
