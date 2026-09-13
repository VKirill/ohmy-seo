import type { ProviderId } from "../providers";
import { YANDEX_SCOPES, YANDEX_DIRECT_SCOPES, GOOGLE_SCOPES } from "../providers";

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  scope: string;
};

export type Identity = {
  subject: string;
  email: string | null;
  login: string | null;
  displayName: string | null;
};

type ProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
  clientId: () => string;
  clientSecret: () => string;
  extraAuthParams: Record<string, string>;
  identity: (accessToken: string) => Promise<Identity>;
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

async function yandexIdentity(accessToken: string): Promise<Identity> {
  const r = await fetch("https://login.yandex.ru/info?format=json", {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!r.ok) throw new Error(`Yandex login.info failed: ${r.status}`);
  const d = (await r.json()) as {
    id: string;
    login?: string;
    default_email?: string;
    real_name?: string;
    display_name?: string;
  };
  if (!d.id || !d.login) throw new Error("Yandex account identity is missing");
  return {
    subject: d.id,
    email: d.default_email ?? null,
    login: d.login ?? null,
    displayName: d.real_name ?? d.display_name ?? d.login ?? null,
  };
}

async function googleIdentity(accessToken: string): Promise<Identity> {
  const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`Google userinfo failed: ${r.status}`);
  const d = (await r.json()) as { sub: string; email?: string; name?: string };
  return {
    subject: d.sub,
    email: d.email ?? null,
    login: d.email ?? null,
    displayName: d.name ?? d.email ?? null,
  };
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  yandex: {
    authorizeUrl: "https://oauth.yandex.ru/authorize",
    tokenUrl: "https://oauth.yandex.ru/token",
    scopes: YANDEX_SCOPES,
    clientId: () => env("YANDEX_CLIENT_ID"),
    clientSecret: () => env("YANDEX_CLIENT_SECRET"),
    // force_confirm is applied only on demand (see authorizeUrl): re-showing
    // the consent screen on every sign-in is noise for a returning user, but
    // it is the only way to attach a second Yandex account from one browser.
    extraAuthParams: {},
    identity: yandexIdentity,
  },
  "yandex-direct": {
    authorizeUrl: "https://oauth.yandex.ru/authorize",
    tokenUrl: "https://oauth.yandex.ru/token",
    scopes: YANDEX_DIRECT_SCOPES,
    clientId: () => env("YANDEX_DIRECT_CLIENT_ID"),
    clientSecret: () => env("YANDEX_DIRECT_CLIENT_SECRET"),
    extraAuthParams: {},
    identity: yandexIdentity,
  },
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: GOOGLE_SCOPES,
    clientId: () => env("GOOGLE_CLIENT_ID"),
    clientSecret: () => env("GOOGLE_CLIENT_SECRET"),
    // select_account, not consent: forcing consent on every sign-in re-shows
    // the permission screen to a user who already granted it. The stored
    // refresh token survives re-authorisation (see the COALESCE in
    // upsertConnection), and the callback falls back to prompt=consent only
    // when no refresh token exists anywhere.
    //
    // include_granted_scopes is deliberately NOT set: it performs incremental
    // authorisation and would drag every scope already granted elsewhere in
    // the Cloud project (Gmail, among others) into our consent screen.
    extraAuthParams: { access_type: "offline", prompt: "select_account" },
    identity: googleIdentity,
  },
};

export function redirectUri(provider: ProviderId): string {
  return `${env("APP_URL")}/api/oauth/${provider}/callback`;
}

export function authorizeUrl(provider: ProviderId, state: string, forceConsent = false, loginHint?: string): string {
  const p = PROVIDERS[provider];
  const u = new URL(p.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId());
  u.searchParams.set("redirect_uri", redirectUri(provider));
  u.searchParams.set("scope", p.scopes.join(" "));
  u.searchParams.set("state", state);
  for (const [k, v] of Object.entries(p.extraAuthParams)) u.searchParams.set(k, v);
  if (forceConsent) {
    if (provider === "google") u.searchParams.set("prompt", "select_account consent");
    else u.searchParams.set("force_confirm", "yes");
  }
  if (loginHint) u.searchParams.set("login_hint", loginHint);
  return u.toString();
}

async function tokenRequest(provider: ProviderId, body: Record<string, string>): Promise<TokenSet> {
  const p = PROVIDERS[provider];
  const r = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: p.clientId(),
      client_secret: p.clientSecret(),
      ...body,
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${provider} token endpoint ${r.status}: ${text.slice(0, 300)}`);
  const d = JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? null,
    expiresInSeconds: d.expires_in ?? 3600,
    scope: d.scope ?? p.scopes.join(" "),
  };
}

export function exchangeCode(provider: ProviderId, code: string): Promise<TokenSet> {
  return tokenRequest(provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(provider),
  });
}

export function refreshTokens(provider: ProviderId, refreshToken: string): Promise<TokenSet> {
  return tokenRequest(provider, { grant_type: "refresh_token", refresh_token: refreshToken });
}
