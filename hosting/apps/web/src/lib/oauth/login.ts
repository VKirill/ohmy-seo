import { PROVIDERS, type Identity } from './index';

export const LOGIN_SCOPES = ['login:info', 'login:email'] as const;

function loginConfig() {
  const clientId = process.env.YANDEX_CLIENT_ID;
  const clientSecret = process.env.YANDEX_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) throw new Error('Yandex sign-in is not configured');
  return { clientId, clientSecret, redirectUri: `${appUrl}/api/oauth/yandex/callback` };
}

/** Existing sign-in application; never requests advertising/analytics scopes. */
export function yandexLoginUrl(state: string): string {
  const config = loginConfig();
  const url = new URL('https://oauth.yandex.ru/authorize');
  url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId,
    redirect_uri: config.redirectUri, scope: LOGIN_SCOPES.join(' '), state,
    force_confirm: 'yes' }).toString();
  return url.toString();
}

/** The temporary login tokens are discarded after reading the identity. */
export async function exchangeYandexLogin(code: string): Promise<Identity> {
  const config = loginConfig();
  const response = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code,
      client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri }),
  });
  if (!response.ok) throw new Error('Yandex sign-in exchange failed');
  const tokens = await response.json() as { access_token?: string };
  if (!tokens.access_token) throw new Error('Yandex sign-in token missing');
  return PROVIDERS.yandex.identity(tokens.access_token);
}
