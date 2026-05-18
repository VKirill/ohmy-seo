// Public surface of @ohmy-seo/mcp-core/google-oauth

export { getGoogleAccessToken } from './token-broker.js';
export type { AccountInput, OAuthAppInput } from './token-broker.js';

export { GoogleAuthError, classifyGoogleError } from './errors.js';
export type { ErrorKind, ClassifiedError } from './errors.js';

export {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  LoopbackListener,
} from './oauth-user-flow.js';
export type {
  TokenResponse,
  BuildAuthorizeUrlOpts,
  ExchangeCodeOpts,
  RefreshAccessTokenOpts,
  LoopbackListenerOpts,
} from './oauth-user-flow.js';

export {
  parseServiceAccountJson,
  signJwtAssertion,
  exchangeJwtForAccessToken,
} from './service-account-flow.js';
export type {
  ServiceAccountKey,
  SignJwtAssertionParams,
  AccessTokenResponse,
  ExchangeJwtParams,
} from './service-account-flow.js';

export {
  SCOPE_GSC_READONLY, SCOPE_GSC_FULL, SCOPE_INDEXING,
  SCOPE_GA4_READONLY, SCOPE_GA4_EDIT, SCOPE_GA4_MANAGE_USERS, SCOPE_GA4_MANAGE_USERS_READONLY,
  SCOPE_GTM_READONLY, SCOPE_GTM_EDIT, SCOPE_GTM_EDIT_VERSIONS, SCOPE_GTM_PUBLISH,
  SCOPE_GTM_DELETE_CONTAINERS, SCOPE_GTM_MANAGE_ACCOUNTS, SCOPE_GTM_MANAGE_USERS,
  SCOPE_YOUTUBE_READONLY, SCOPE_YOUTUBE, SCOPE_YOUTUBE_FORCE_SSL,
  SCOPE_YT_ANALYTICS_READONLY, SCOPE_YT_ANALYTICS_MONETARY_READONLY,
  SCOPE_DRIVE_READONLY, SCOPE_DRIVE_FILE, SCOPE_DRIVE,
  SCOPE_SPREADSHEETS, SCOPE_SPREADSHEETS_READONLY,
  ALL_GSC_SCOPES, ALL_GA4_SCOPES, ALL_GTM_SCOPES,
} from './scopes.js';
