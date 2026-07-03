import { request } from "@ohmy-seo/mcp-core/http";
import { errorToMcpContent, ApiError } from "@ohmy-seo/mcp-core/errors";
import { getAccessToken } from "../lib/oauth/token-broker.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { getAccountById } from "../lib/db/accounts-repo.js";
import { SCOPES, hasScope } from "../lib/scopes.js";

const CLIENT_LOGIN_RE = /^[a-z0-9._@-]{1,255}$/;

export async function runYandexDirectAccountBalance(input: {
  account_id?: number;
  client_login: string;
}) {
  try {
    const clientLogin = input.client_login.trim().toLowerCase();
    if (!CLIENT_LOGIN_RE.test(clientLogin)) {
      return {
        isError: true as const,
        content: [{ type: "text" as const, text: `Invalid client_login: must match ^[a-z0-9._@-]{1,255}$. Got: "${input.client_login}"` }],
      };
    }

    let accId: number;
    if (input.account_id !== undefined) {
      const id = input.account_id;
      if (!Number.isInteger(id) || id <= 0) {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: "account_id must be a positive integer" }],
        };
      }
      const acc = getAccountById(id);
      if (!acc) {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: `Account id=${id} not found` }],
        };
      }
      if (!hasScope(acc.scopes_granted, SCOPES.DIRECT_API)) {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: `Account id=${id} (label="${acc.label}") lacks required scope 'direct:api'. Granted: '${acc.scopes_granted}'` }],
        };
      }
      accId = acc.id;
    } else {
      const acc = resolveAccount(SCOPES.DIRECT_API);
      accId = acc.id;
    }

    const token = await getAccessToken(accId);
    const url = "https://api.direct.yandex.ru/live/v4/json/";
    const resp = await request(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Login": clientLogin,
        "Accept-Language": "ru",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        method: "AccountManagement",
        token,
        param: { Action: "Get", SelectionCriteria: { Logins: [clientLogin] } },
        locale: "ru",
      }),
    });

    // v4 Live returns HTTP 200 even for logical errors
    const respData = resp.data as Record<string, unknown>;
    if (respData.error_code !== undefined) {
      throw new ApiError(
        200,
        JSON.stringify({
          error_code: respData.error_code,
          error_str: respData.error_str,
          error_detail: respData.error_detail,
        })
      );
    }

    const data = respData.data as Record<string, unknown> | undefined;
    const accounts = data?.Accounts as unknown[] | undefined;
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return {
        isError: true as const,
        content: [{ type: "text" as const, text: `No account returned for login "${clientLogin}" from Yandex Direct v4` }],
      };
    }

    const a = accounts[0] as Record<string, unknown>;
    const emailNotif = (a.EmailNotification ?? {}) as Record<string, unknown>;
    const smsNotif = (a.SmsNotification ?? {}) as Record<string, unknown>;

    const projected = {
      login: String(a.Login ?? ""),
      account_id: Number(a.AccountID),
      amount: Number(a.Amount),
      amount_available_for_transfer: Number(a.AmountAvailableForTransfer),
      currency: String(a.Currency ?? ""),
      agency_name: String(a.AgencyName ?? ""),
      email_notification: {
        email: String(emailNotif.Email ?? ""),
        money_warning_value: Number(emailNotif.MoneyWarningValue),
        paused_by_day_budget: String(emailNotif.PausedByDayBudget ?? ""),
      },
      sms_notification: {
        money_in_sms: String(smsNotif.MoneyInSms ?? ""),
        money_out_sms: String(smsNotif.MoneyOutSms ?? ""),
        paused_by_day_budget_sms: String(smsNotif.PausedByDayBudgetSms ?? ""),
        sms_time_from: String(smsNotif.SmsTimeFrom ?? ""),
        sms_time_to: String(smsNotif.SmsTimeTo ?? ""),
      },
      account_day_budget: a.AccountDayBudget !== undefined ? Number(a.AccountDayBudget) : null,
      raw: respData,
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(projected, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
