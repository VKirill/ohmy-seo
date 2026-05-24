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
});

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
    ReportName: `search-terms-${Date.now()}`,
    ReportType: "SEARCH_QUERY_PERFORMANCE_REPORT",
    DateRangeType: parsed.date_range_type,
    Format: "TSV",
    IncludeVAT: "YES",
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
          text: JSON.stringify({ search_terms: result.rows ?? [], ok: result.ok, attempts: result.attempts, total_wait_ms: result.total_wait_ms }, null, 2),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
