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
  mutagen_competition: SCOPES.DIRECT_API,
};
