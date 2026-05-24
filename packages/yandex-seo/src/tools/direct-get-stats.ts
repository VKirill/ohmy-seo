import { pollReport } from "../lib/api/reports-polling.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

const InputSchema = z.object({
  report_name: z.string().min(1).describe("Unique report name (used by Yandex to cache results server-side)"),
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
    .default(["Date", "CampaignId", "Impressions", "Clicks", "Cost", "Conversions", "Ctr", "AvgCpc"])
    .describe("List of field names to include in the report"),
  report_type: z
    .string()
    .default("CUSTOM_REPORT")
    .describe("Report type, e.g. CUSTOM_REPORT, CAMPAIGN_PERFORMANCE_REPORT"),
  include_vat: z
    .enum(["YES", "NO"])
    .default("YES")
    .describe("Whether to include VAT in monetary metrics"),
  selection_criteria: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional selection criteria, e.g. { CampaignIds: [123], Filter: [...] }"),
  account: z
    .string()
    .min(1)
    .optional()
    .describe("Account label from list_accounts (optional if a default account is configured)"),
});

export async function runDirectGetStats(input: z.infer<typeof InputSchema>) {
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
    SelectionCriteria: parsed.selection_criteria ?? {},
    FieldNames: parsed.field_names,
    ReportName: parsed.report_name,
    ReportType: parsed.report_type,
    DateRangeType: parsed.date_range_type,
    Format: "TSV",
    IncludeVAT: parsed.include_vat,
    IncludeDiscount: "NO",
  };

  if (parsed.date_range_type === "CUSTOM_DATE") {
    params.DateFrom = parsed.date_from;
    params.DateTo = parsed.date_to;
  }

  const body = { params };

  try {
    const result = await pollReport({ body, accountLabel: parsed.account });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
