export const SCOPES = {
  WEBMASTER_HOSTINFO: "webmaster:hostinfo",
  WEBMASTER_VERIFY: "webmaster:verify",
  METRIKA_READ: "metrika:read",
  DIRECT_API: "direct:api",
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

/**
 * Returns true if the required scope appears in the space-delimited grantedScopes string.
 */
export function hasScope(grantedScopes: string, required: Scope): boolean {
  return grantedScopes.split(/\s+/).some((s) => s === required);
}

export const REQUIRED_SCOPE_BY_TOOL: Record<string, Scope> = {
  webmaster_site_summary: SCOPES.WEBMASTER_HOSTINFO,
  webmaster_top_queries: SCOPES.WEBMASTER_HOSTINFO,
  webmaster_indexing_issues: SCOPES.WEBMASTER_HOSTINFO,
  metrika_search_phrases: SCOPES.METRIKA_READ,
  metrika_traffic_summary: SCOPES.METRIKA_READ,
  wordstat_keywords: SCOPES.DIRECT_API,
};
