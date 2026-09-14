import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  account: vi.fn(), token: vi.fn(), probe: vi.fn(), save: vi.fn(), hosts: vi.fn(),
  upsert: vi.fn(), success: vi.fn(), error: vi.fn(),
}));
vi.mock("../src/lib/db/accounts-repo.js", () => ({ getAccountById: mocks.account, updateWebmasterUserId: mocks.save }));
vi.mock("../src/lib/oauth/token-broker.js", () => ({ getAccessToken: mocks.token }));
vi.mock("../src/lib/oauth/login-probe.js", () => ({ probeWebmasterUserId: mocks.probe }));
vi.mock("../src/lib/webmaster-client.js", () => ({ getHostsList: mocks.hosts }));
vi.mock("../src/lib/metrika-client.js", () => ({ getCountersList: vi.fn() }));
vi.mock("../src/lib/db/inventory-repo.js", () => ({
  upsertSitesForAccount: mocks.upsert, upsertCountersForAccount: vi.fn(),
  setRefreshMetaSuccess: mocks.success, setRefreshMetaError: mocks.error,
}));
import { refreshSitesForAccount } from "../src/lib/inventory/refresher.js";
describe("Webmaster inventory discovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.account.mockReturnValue({ label: "hosted", webmaster_user_id: null, scopes_granted: "webmaster:hostinfo" });
    mocks.token.mockResolvedValue("test-token");
    mocks.probe.mockResolvedValue(123);
    mocks.hosts.mockResolvedValue([{ host_id: "example", ascii_host_url: "https://example.org", verified: true }]);
    mocks.upsert.mockReturnValue({ inserted: 1, updated: 0, removed: 0 });
  });
  it("discovers and persists the user ID before listing hosted sites", async () => {
    expect(await refreshSitesForAccount(5)).toMatchObject({ fetched: 1, error: null });
    expect(mocks.probe).toHaveBeenCalledWith("test-token");
    expect(mocks.save).toHaveBeenCalledWith(5, 123);
    expect(mocks.hosts).toHaveBeenCalledWith({ accessToken: "test-token", webmasterUserId: "123" });
  });
  it("uses a previously discovered ID without probing again", async () => {
    mocks.account.mockReturnValue({ label: "existing", webmaster_user_id: 456, scopes_granted: "webmaster:hostinfo" });
    expect(await refreshSitesForAccount(5)).toMatchObject({ fetched: 1, error: null });
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.hosts).toHaveBeenCalledWith({ accessToken: "test-token", webmasterUserId: "456" });
  });
  it("preserves cached sites and records a failed probe for retry", async () => {
    mocks.probe.mockResolvedValue(null);
    expect(await refreshSitesForAccount(5)).toMatchObject({ fetched: 0, error: expect.stringContaining("Cannot resolve") });
    expect(mocks.error).toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.probe.mockResolvedValue(123);
    expect(await refreshSitesForAccount(5)).toMatchObject({ fetched: 1, error: null });
  });
  it("does not probe accounts without Webmaster access", async () => {
    mocks.account.mockReturnValue({ label: "limited", webmaster_user_id: null, scopes_granted: "metrika:read" });
    expect(await refreshSitesForAccount(5)).toMatchObject({ error: expect.stringContaining("lacks") });
    expect(mocks.token).not.toHaveBeenCalled();
  });
});
