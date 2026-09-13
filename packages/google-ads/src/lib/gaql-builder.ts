/**
 * Typed GAQL composer plus pre-flight validation.
 *
 * Catches the three mistakes an LLM makes most often before a request is spent:
 * a missing primary field, a metric query without a date range, and a query
 * without LIMIT.
 */

const OMIT_RESOURCE_NAMES = "PARAMETERS omit_unselected_resource_names=true";

/** Date-range literals accepted by GAQL's DURING operator. */
export const DATE_RANGES = [
  "TODAY",
  "YESTERDAY",
  "LAST_7_DAYS",
  "LAST_14_DAYS",
  "LAST_30_DAYS",
  "THIS_WEEK_SUN_TODAY",
  "THIS_WEEK_MON_TODAY",
  "LAST_WEEK_SUN_SAT",
  "LAST_WEEK_MON_SUN",
  "LAST_BUSINESS_WEEK",
  "THIS_MONTH",
  "LAST_MONTH",
] as const;

export type DateRange = (typeof DATE_RANGES)[number];

/**
 * Resource -> field that Google requires in SELECT for that resource.
 * Missing it yields EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE.
 */
export const PRIMARY_FIELDS: Record<string, string> = {
  keyword_view: "ad_group_criterion.criterion_id",
  search_term_view: "search_term_view.search_term",
  geographic_view: "campaign.id",
  group_placement_view: "group_placement_view.placement",
  landing_page_view: "landing_page_view.unexpanded_final_url",
  expanded_landing_page_view: "expanded_landing_page_view.expanded_final_url",
  shopping_performance_view: "campaign.id",
  asset_group_asset: "asset.id",
  change_event: "change_event.resource_name",
  campaign_search_term_insight: "campaign_search_term_insight.id",
};

export class GaqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GaqlError";
  }
}

export interface QuerySpec {
  select: string[];
  from: string;
  where?: string[];
  orderBy?: string;
  limit?: number;
}

/** Builds a GAQL string and enforces the primary-field rule. */
export function buildQuery(spec: QuerySpec): string {
  const select = [...spec.select];
  const primary = PRIMARY_FIELDS[spec.from];
  if (primary && !select.includes(primary)) select.unshift(primary);

  const parts = [`SELECT ${select.join(", ")}`, `FROM ${spec.from}`];
  if (spec.where && spec.where.length > 0) parts.push(`WHERE ${spec.where.join(" AND ")}`);
  if (spec.orderBy) parts.push(`ORDER BY ${spec.orderBy}`);
  if (spec.limit !== undefined) parts.push(`LIMIT ${Math.max(1, Math.floor(spec.limit))}`);
  parts.push(OMIT_RESOURCE_NAMES);
  return parts.join(" ");
}

/** `segments.date DURING LAST_30_DAYS` or a BETWEEN clause for explicit dates. */
export function dateClause(range: string): string {
  const value = range.trim().toUpperCase();
  if ((DATE_RANGES as readonly string[]).includes(value)) {
    return `segments.date DURING ${value}`;
  }
  const explicit = range.trim().match(/^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|,|\s)\s*(\d{4}-\d{2}-\d{2})$/);
  if (explicit) {
    return `segments.date BETWEEN '${explicit[1]}' AND '${explicit[2]}'`;
  }
  throw new GaqlError(
    `Unknown date_range "${range}". Use one of ${DATE_RANGES.join(", ")} ` +
      `or an explicit "YYYY-MM-DD..YYYY-MM-DD" pair.`,
  );
}

/** Escapes a string literal for use inside a GAQL condition. */
export function gaqlLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export interface ValidationResult {
  query: string;
  warnings: string[];
}

/**
 * Validates a raw agent-supplied GAQL string.
 *
 * Rejects: empty, multi-statement, non-SELECT, missing FROM, OFFSET (GAQL has
 * none). Warns: metrics without a date range, no LIMIT, missing primary field.
 */
export function validateRawGaql(raw: string, defaultLimit = 500): ValidationResult {
  const query = raw.trim().replace(/;\s*$/, "");

  if (query.length === 0) throw new GaqlError("Query is empty.");
  if (query.includes(";")) throw new GaqlError("Only a single statement is allowed — remove ';'.");
  if (!/^SELECT\s/i.test(query)) throw new GaqlError("Query must start with SELECT.");
  if (!/\sFROM\s/i.test(query)) throw new GaqlError("Query must contain a FROM clause.");
  if (/\sOFFSET\s/i.test(query)) {
    throw new GaqlError("GAQL has no OFFSET. Paginate with page_token or narrow the filter.");
  }

  const fromMatch = query.match(/\sFROM\s+([a-z_][a-z0-9_]*)/i);
  const resource = fromMatch?.[1]?.toLowerCase() ?? "";
  const warnings: string[] = [];

  const primary = PRIMARY_FIELDS[resource];
  if (primary && !query.includes(primary)) {
    throw new GaqlError(
      `Resource "${resource}" requires "${primary}" in the SELECT clause, otherwise ` +
        "Google returns EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE.",
    );
  }

  const hasMetrics = /\bmetrics\./i.test(query);
  const hasDate = /segments\.date/i.test(query) || /\bDURING\b/i.test(query);
  if (hasMetrics && !hasDate) {
    warnings.push(
      "Query selects metrics without a date range — Google will return lifetime totals.",
    );
  }

  let finalQuery = query;
  if (!/\sLIMIT\s+\d+/i.test(query)) {
    finalQuery = `${query} LIMIT ${defaultLimit}`;
    warnings.push(`No LIMIT in query — appended LIMIT ${defaultLimit}.`);
  }
  if (!/omit_unselected_resource_names/i.test(finalQuery)) {
    finalQuery = `${finalQuery} ${OMIT_RESOURCE_NAMES}`;
  }

  if (resource === "change_event" && !/\sLIMIT\s+\d+/i.test(query)) {
    warnings.push("change_event requires a finite LIMIT of at most 10000.");
  }

  return { query: finalQuery, warnings };
}
