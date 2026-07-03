import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mock references are available inside vi.mock factory callbacks
const { mockRequest, mockGetAccessToken, mockResolveAccount, mockGetAccountById } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockResolveAccount: vi.fn(),
  mockGetAccountById: vi.fn(),
}));

vi.mock("@ohmy-seo/mcp-core/http", () => ({ request: mockRequest }));

vi.mock("@ohmy-seo/mcp-core/errors", () => {
  class ApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string) {
      super(`API error ${status}`);
      this.name = "ApiError";
      this.status = status;
      this.body = body;
    }
  }
  return {
    errorToMcpContent: (err: unknown) => {
      let text: string;
      if (err instanceof ApiError) {
        text = `API error ${err.status}. Body: ${err.body}`;
      } else {
        text = String(err);
      }
      return { isError: true, content: [{ type: "text", text }] };
    },
    ApiError,
  };
});

vi.mock("../src/lib/oauth/token-broker.js", () => ({ getAccessToken: mockGetAccessToken }));
vi.mock("../src/lib/account-resolver.js", () => ({ resolveAccount: mockResolveAccount }));
vi.mock("../src/lib/db/accounts-repo.js", () => ({ getAccountById: mockGetAccountById }));

vi.mock("../src/lib/scopes.js", () => ({
  SCOPES: { DIRECT_API: "direct:api" },
  hasScope: (granted: string, required: string) =>
    granted.split(/\s+/).some((s: string) => s === required),
}));

import { runYandexDirectAccountBalance } from "../src/tools/yandex-direct-account-balance.js";

// ---------------------------------------------------------------------------
// Canned v4 response fixture
// ---------------------------------------------------------------------------

const CANNED_ACCOUNT = {
  AccountID: 123456,
  Login: "porg-nqhs6wbe",
  Amount: "900.04",
  AmountAvailableForTransfer: "850.00",
  Currency: "RUB",
  AgencyName: "Test Agency",
  EmailNotification: {
    Email: "test@example.com",
    MoneyWarningValue: 100,
    PausedByDayBudget: "NO",
  },
  SmsNotification: {
    MoneyInSms: "YES",
    MoneyOutSms: "NO",
    PausedByDayBudgetSms: "NO",
    SmsTimeFrom: "09:00",
    SmsTimeTo: "21:00",
  },
  AccountDayBudget: 5000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAccessToken.mockResolvedValue("dummy-token-abc123");
  mockResolveAccount.mockReturnValue({ id: 1 });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("runYandexDirectAccountBalance — happy path (implicit account)", () => {
  it("returns projected fields with correct types", async () => {
    mockRequest.mockResolvedValue({
      data: { data: { Accounts: [CANNED_ACCOUNT] } },
      status: 200,
      headers: {},
    });

    const result = await runYandexDirectAccountBalance({ client_login: "porg-nqhs6wbe" });

    expect((result as { isError?: boolean }).isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);

    expect(parsed.login).toBe("porg-nqhs6wbe");
    expect(parsed.account_id).toBe(123456);
    expect(typeof parsed.amount).toBe("number");
    expect(parsed.amount).toBe(900.04);
    expect(parsed.currency).toBe("RUB");
    expect(parsed.agency_name).toBe("Test Agency");

    expect(parsed.email_notification.email).toBe("test@example.com");
    expect(parsed.email_notification.money_warning_value).toBe(100);
    expect(parsed.email_notification.paused_by_day_budget).toBe("NO");
    expect(parsed.sms_notification.money_in_sms).toBe("YES");
    expect(parsed.sms_notification.sms_time_from).toBe("09:00");

    expect(parsed.raw).toBeDefined();
    expect(typeof parsed.raw).toBe("object");
    expect(parsed.account_day_budget).toBe(5000);
  });

  it("sets account_day_budget to null when field is absent", async () => {
    const noDay = { ...CANNED_ACCOUNT } as Record<string, unknown>;
    delete noDay.AccountDayBudget;

    mockRequest.mockResolvedValue({
      data: { data: { Accounts: [noDay] } },
      status: 200,
      headers: {},
    });

    const result = await runYandexDirectAccountBalance({ client_login: "porg-nqhs6wbe" });
    const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
    expect(parsed.account_day_budget).toBeNull();
  });

  it("uses resolveAccount when account_id is omitted", async () => {
    mockRequest.mockResolvedValue({
      data: { data: { Accounts: [CANNED_ACCOUNT] } },
      status: 200,
      headers: {},
    });

    await runYandexDirectAccountBalance({ client_login: "porg-nqhs6wbe" });
    expect(mockResolveAccount).toHaveBeenCalledWith("direct:api");
    expect(mockGetAccessToken).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// v4 logical errors
// ---------------------------------------------------------------------------

describe("runYandexDirectAccountBalance — v4 logical errors", () => {
  it("returns isError when body has error_code (numeric)", async () => {
    mockRequest.mockResolvedValue({
      data: { error_code: 152, error_str: "Not found", error_detail: "login unknown" },
      status: 200,
      headers: {},
    });

    const result = await runYandexDirectAccountBalance({ client_login: "porg-nqhs6wbe" });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect((result.content[0] as { type: string; text: string }).text).toContain("152");
  });

  it("returns isError when Accounts array is empty", async () => {
    mockRequest.mockResolvedValue({
      data: { data: { Accounts: [] } },
      status: 200,
      headers: {},
    });

    const result = await runYandexDirectAccountBalance({ client_login: "porg-nqhs6wbe" });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect((result.content[0] as { type: string; text: string }).text).toContain("No account returned");
  });

  it("returns isError when data is missing entirely", async () => {
    mockRequest.mockResolvedValue({ data: {}, status: 200, headers: {} });

    const result = await runYandexDirectAccountBalance({ client_login: "porg-nqhs6wbe" });
    expect((result as { isError?: boolean }).isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe("runYandexDirectAccountBalance — input validation", () => {
  it("rejects client_login with invalid charset (space)", async () => {
    const result = await runYandexDirectAccountBalance({ client_login: "invalid login!" });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect((result.content[0] as { type: string; text: string }).text).toContain("Invalid client_login");
  });

  it("trims and lowercases client_login before use", async () => {
    mockRequest.mockResolvedValue({
      data: { data: { Accounts: [CANNED_ACCOUNT] } },
      status: 200,
      headers: {},
    });

    await runYandexDirectAccountBalance({ client_login: "  Porg-NQHS6WBE  " });

    const callInit = (mockRequest.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
    expect(callInit.headers["Client-Login"]).toBe("porg-nqhs6wbe");
  });
});

// ---------------------------------------------------------------------------
// Token security
// ---------------------------------------------------------------------------

describe("runYandexDirectAccountBalance — token security", () => {
  it("does not include the access token in any returned content or raw field", async () => {
    const sensitiveToken = "ya-super-secret-access-token-xyz789";
    mockGetAccessToken.mockResolvedValue(sensitiveToken);

    mockRequest.mockResolvedValue({
      data: { data: { Accounts: [CANNED_ACCOUNT] } },
      status: 200,
      headers: {},
    });

    const result = await runYandexDirectAccountBalance({ client_login: "porg-nqhs6wbe" });
    const outputText = JSON.stringify(result);
    expect(outputText).not.toContain(sensitiveToken);
  });

  it("sends token in Authorization header but never leaks it into output text", async () => {
    const sensitiveToken = "ya-bearer-token-do-not-leak";
    mockGetAccessToken.mockResolvedValue(sensitiveToken);

    mockRequest.mockResolvedValue({
      data: { data: { Accounts: [CANNED_ACCOUNT] } },
      status: 200,
      headers: {},
    });

    await runYandexDirectAccountBalance({ client_login: "porg-nqhs6wbe" });

    const callInit = (mockRequest.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
    expect(callInit.headers["Authorization"]).toBe(`Bearer ${sensitiveToken}`);

    const result = await runYandexDirectAccountBalance({ client_login: "porg-nqhs6wbe" });
    const outputText = (result.content[0] as { type: string; text: string }).text;
    expect(outputText).not.toContain(sensitiveToken);
  });
});

// ---------------------------------------------------------------------------
// account_id resolution
// ---------------------------------------------------------------------------

describe("runYandexDirectAccountBalance — account_id resolution", () => {
  it("uses getAccountById when account_id is provided", async () => {
    mockGetAccountById.mockReturnValue({
      id: 42,
      label: "test-acc",
      scopes_granted: "direct:api",
    });
    mockRequest.mockResolvedValue({
      data: { data: { Accounts: [CANNED_ACCOUNT] } },
      status: 200,
      headers: {},
    });

    await runYandexDirectAccountBalance({ account_id: 42, client_login: "porg-nqhs6wbe" });

    expect(mockGetAccountById).toHaveBeenCalledWith(42);
    expect(mockGetAccessToken).toHaveBeenCalledWith(42);
    expect(mockResolveAccount).not.toHaveBeenCalled();
  });

  it("returns isError when account_id not found", async () => {
    mockGetAccountById.mockReturnValue(null);

    const result = await runYandexDirectAccountBalance({ account_id: 99, client_login: "porg-nqhs6wbe" });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect((result.content[0] as { type: string; text: string }).text).toContain("not found");
  });

  it("returns isError when account lacks direct:api scope", async () => {
    mockGetAccountById.mockReturnValue({
      id: 7,
      label: "no-direct",
      scopes_granted: "metrika:read webmaster:hostinfo",
    });

    const result = await runYandexDirectAccountBalance({ account_id: 7, client_login: "porg-nqhs6wbe" });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect((result.content[0] as { type: string; text: string }).text).toContain("direct:api");
  });
});
