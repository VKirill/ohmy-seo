import { request } from "@ohmy-seo/mcp-core/http";
import { OAuthFlowError } from "@ohmy-seo/mcp-core/errors";

export type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_in: number;   // seconds from now
  scope: string;        // granted (may differ from declared)
  token_type: string;   // "bearer"
};

const REDIRECT_URI = "https://oauth.yandex.ru/verification_code";
const TOKEN_URL = "https://oauth.yandex.ru/token";
const AUTHORIZE_BASE = "https://oauth.yandex.ru/authorize?response_type=code";

export function buildAuthorizeUrl(app: {
  client_id: string;
  scopes_declared: string;
}): string {
  return (
    AUTHORIZE_BASE +
    "&client_id=" + encodeURIComponent(app.client_id) +
    "&redirect_uri=" + encodeURIComponent(REDIRECT_URI) +
    "&scope=" + encodeURIComponent(app.scopes_declared)
  );
}

function parseTokenResponse(data: unknown): TokenSet {
  if (typeof data !== "object" || data === null) {
    throw new OAuthFlowError("Unexpected token response shape");
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj["error"] === "string") {
    throw new OAuthFlowError(
      "Yandex token error: " + obj["error_description"],
      obj["error"] as string,
    );
  }

  const access_token = obj["access_token"];
  const refresh_token = obj["refresh_token"];
  const expires_in = obj["expires_in"];
  const token_type = obj["token_type"];

  if (
    typeof access_token !== "string" ||
    typeof refresh_token !== "string" ||
    typeof expires_in !== "number" ||
    typeof token_type !== "string"
  ) {
    throw new OAuthFlowError("Missing required fields in token response");
  }

  const scope = typeof obj["scope"] === "string" ? obj["scope"] : "";

  return { access_token, refresh_token, expires_in, scope, token_type };
}

function basicAuth(clientId: string, clientSecret: string): string {
  return "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64");
}

export async function exchangeCode(
  app: { client_id: string; client_secret: string },
  code: string,
): Promise<TokenSet> {
  const body = "grant_type=authorization_code&code=" + encodeURIComponent(code);
  const resp = await request(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(app.client_id, app.client_secret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return parseTokenResponse(resp.data);
}

export async function refreshAccessToken(
  app: { client_id: string; client_secret: string },
  refreshToken: string,
): Promise<TokenSet> {
  const body =
    "grant_type=refresh_token&refresh_token=" + encodeURIComponent(refreshToken);
  const resp = await request(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(app.client_id, app.client_secret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return parseTokenResponse(resp.data);
}
