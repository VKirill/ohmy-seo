import { createHash } from "node:crypto";
import { pollReport } from "../lib/api/reports-polling.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

const DEFAULT_FIELDS = ["Query", "CampaignId", "AdGroupId", "Impressions", "Clicks", "Cost", "Conversions", "Ctr", "AvgCpc"];

const InputSchema = z.object({
  campaign_ids: z
    .array(z.number())
    .min(1)
    .describe("Campaign IDs to filter search query performance by (required)"),
  date_range_type: z
    .enum(["TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_30_DAYS", "CUSTOM_DATE"])
    .default("LAST_7_DAYS")
    .describe("Predefined date range or CUSTOM_DATE (requires date_from and date_to)"),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "date_from must be YYYY-MM-DD" })
    .optional()
    .describe("Start date (YYYY-MM-DD), required when date_range_type is CUSTOM_DATE"),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "date_to must be YYYY-MM-DD" })
    .optional()
    .describe("End date (YYYY-MM-DD), required when date_range_type is CUSTOM_DATE"),
  field_names: z
    .array(z.string())
    .default(DEFAULT_FIELDS)
    .describe("List of field names to include in the report"),
  account: z
    .string()
    .min(1)
    .optional()
    .describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z
    .string()
    .min(1)
    .optional()
    .describe("Yandex Direct agency sub-client login, sent as the Client-Login header (e.g. 'agency-client-login'). Required to pull search-term reports for an agency sub-client rather than the token owner's own account."),
  report_name: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe("Report name to fetch again (from a previous `pending` response). Omit to derive a stable name from the request."),
});

/**
 * Stable ReportName for a request: a repeated call fetches the report Direct is
 * already building instead of queueing a new one (and hitting error 56 again).
 * The Moscow day — plus the hour for TODAY — keeps cached reports from going stale.
 */
export function searchTermsReportName(params: Record<string, unknown>, clientLogin?: string, now = new Date()): string {
  const moscow = new Date(now.getTime() + 3 * 3600_000).toISOString();
  const bucket = params.DateRangeType === "TODAY" ? moscow.slice(0, 13) : moscow.slice(0, 10);
  const hash = createHash("sha256")
    .update(JSON.stringify({ params, clientLogin: clientLogin ?? null, bucket }))
    .digest("hex")
    .slice(0, 16);
  return `search-terms-${hash}`;
}

export async function runDirectGetSearchTerms(input: z.infer<typeof InputSchema>) {
  const parsed = InputSchema.parse(input);

  if (parsed.date_range_type === "CUSTOM_DATE" && (!parsed.date_from || !parsed.date_to)) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "date_from and date_to are required when date_range_type is CUSTOM_DATE" }),
        },
      ],
    };
  }

  const params: Record<string, unknown> = {
    SelectionCriteria: {
      Filter: [
        {
          Field: "CampaignId",
          Operator: "IN",
          Values: parsed.campaign_ids.map(String),
        },
      ],
    },
    FieldNames: parsed.field_names,
    ReportType: "SEARCH_QUERY_PERFORMANCE_REPORT",
    DateRangeType: parsed.date_range_type,
    Format: "TSV",
    IncludeVAT: "YES",
    IncludeDiscount: "NO",
  };

  if (parsed.date_range_type === "CUSTOM_DATE") {
    // Reports API expects DateFrom/DateTo inside SelectionCriteria, not at the
    // top level of params (top-level → error 8000 "unknown field DateFrom").
    const sc = (params.SelectionCriteria ?? {}) as Record<string, unknown>;
    sc.DateFrom = parsed.date_from;
    sc.DateTo = parsed.date_to;
    params.SelectionCriteria = sc;
  }

  params.ReportName = parsed.report_name ?? searchTermsReportName(params, parsed.client_login);
  const body = { params };

  try {
    const result = await pollReport({ body, accountLabel: parsed.account, clientLogin: parsed.client_login });
    const meta = { report_name: result.report_name, attempts: result.attempts, total_wait_ms: result.total_wait_ms };
    const payload = result.ok
      ? { search_terms: result.rows ?? [], ok: true, ...meta }
      : result.pending
        // No search_terms key: a report still being built must not read as an empty one.
        ? {
            ok: false,
            pending: true,
            retry_after_ms: result.retry_after_ms,
            message: "Report is still being built. Repeat the call with the same report_name after retry_after_ms.",
            ...meta,
          }
        // Keep Direct's status and error body so a failed report never reads as an empty one.
        : { search_terms: [], ok: false, status: result.status, error_code: result.error_code, error: result.error, ...meta };
    return {
      ...(result.ok || result.pending ? {} : { isError: true as const }),
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
