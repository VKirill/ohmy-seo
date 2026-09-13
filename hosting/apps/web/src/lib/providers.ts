export type ProviderId = "yandex" | "yandex-direct" | "google";

/**
 * Login and account connection are one and the same flow: signing in with
 * Yandex already grants the service scopes, so the user never has to come
 * back and "also connect" the account they just logged in with.
 *
 * Yandex caps one OAuth app at three services, and login + Metrika + Webmaster
 * already fills it. Direct therefore lives in a second app with its own client
 * credentials, surfaced here as the separate "yandex-direct" provider.
 */
export const YANDEX_SCOPES = [
  "login:email",
  "login:info",
  "metrika:read",
  "metrika:write",
  "webmaster:hostinfo",
  "webmaster:verify",
] as const;

/**
 * No login scopes here on purpose. Yandex counts "API Яндекс ID" as one of the
 * three services an app may hold. Basic id/login are available from
 * login.yandex.ru/info even without login scopes; always inspect the token.
 */
export const YANDEX_DIRECT_SCOPES = [
  "direct:api",
  "audience:read",
  "audience:write",
  "cloud:auth",
] as const;

/**
 * Read-only by design. The platform keeps OHMY_SEO_ALLOW_LIVE_MUTATIONS unset,
 * so asking for write scopes would mean holding rights we never exercise.
 * The read-only variants are also merely "sensitive" rather than "restricted",
 * which keeps Google verification to a review instead of a security audit.
 *
 * To enable writing later, swap in the wider scopes below and have users
 * re-authorise — Google will not grant them retroactively:
 *   webmasters                        (sitemaps, Indexing API)
 *   analytics.edit                    (GA4 Admin writes)
 *   tagmanager.edit.containers        (create/update tags)
 *   tagmanager.publish                (publish/rollback versions)
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/tagmanager.readonly",
] as const;

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  yandex: "Яндекс",
  "yandex-direct": "Яндекс Директ, Аудитории и Облако",
  google: "Google",
};

/** Services a connection unlocks, for display in the dashboard. */
export const PROVIDER_SERVICES: Record<ProviderId, string[]> = {
  yandex: ["Яндекс Метрика", "Яндекс Вебмастер"],
  "yandex-direct": ["Яндекс Директ", "Яндекс Аудитории", "Яндекс Облако"],
  google: ["Search Console", "Analytics 4", "Tag Manager"],  // чтение
};

export const ALL_PROVIDERS: ProviderId[] = ["yandex", "yandex-direct", "google"];

/**
 * Yandex needs two OAuth apps to cover Metrika, Webmaster and Direct, but that
 * is our problem, not the user's: both providers belong to one family shown as
 * a single account with a single button. `chain` is the provider whose flow
 * starts automatically once this one finishes.
 */
export type FamilyId = "yandex" | "google";

export const PROVIDER_FAMILY: Record<ProviderId, FamilyId> = {
  yandex: "yandex",
  "yandex-direct": "yandex",
  google: "google",
};

export const FAMILY_ENTRY: Record<FamilyId, ProviderId> = {
  yandex: "yandex",
  google: "google",
};

// Three apps, one button: Yandex allows three services per app, and login
// occupies a slot in each, so Metrika+Webmaster, Direct+Audiences and Cloud
// cannot share one registration.
export const CHAIN_AFTER: Partial<Record<ProviderId, ProviderId>> = {
  yandex: "yandex-direct",
};

export const FAMILY_LABEL: Record<FamilyId, string> = {
  yandex: "Яндекс",
  google: "Google",
};

export const FAMILY_SERVICES: Record<FamilyId, string[]> = {
  yandex: [
    "Яндекс Директ",
    "Яндекс Метрика",
    "Яндекс Вебмастер",
    "Яндекс Аудитории",
    "Яндекс Облако",
  ],
  google: ["Search Console", "Analytics 4", "Tag Manager"],
};

export function isProviderId(v: string): v is ProviderId {
  return (ALL_PROVIDERS as string[]).includes(v);
}
