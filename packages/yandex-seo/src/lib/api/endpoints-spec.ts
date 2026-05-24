import { SCOPES, type Scope } from "../scopes.js";

export type ApiName = "metrika" | "webmaster" | "direct";

export interface ApiSpec {
  baseUrl: string;
  authPrefix: "OAuth" | "Bearer";
  requiredScope: Scope;
  supportsClientLogin: boolean;
  defaultMethod: "GET" | "POST" | "PUT" | "DELETE";
}

const DIRECT_BASE_URL =
  process.env.DIRECT_USE_SANDBOX === "true"
    ? "https://api-sandbox.direct.yandex.com"
    : "https://api.direct.yandex.com";

const SPECS: Record<ApiName, ApiSpec> = {
  metrika: {
    baseUrl: "https://api-metrika.yandex.net",
    authPrefix: "OAuth",
    requiredScope: SCOPES.METRIKA_READ,
    supportsClientLogin: false,
    defaultMethod: "GET",
  },
  webmaster: {
    baseUrl: "https://api.webmaster.yandex.net",
    authPrefix: "OAuth",
    requiredScope: SCOPES.WEBMASTER_HOSTINFO,
    supportsClientLogin: false,
    defaultMethod: "GET",
  },
  direct: {
    baseUrl: DIRECT_BASE_URL,
    authPrefix: "Bearer",
    requiredScope: SCOPES.DIRECT_API,
    supportsClientLogin: true,
    defaultMethod: "POST",
  },
};

export function getApiSpec(name: ApiName): ApiSpec {
  return SPECS[name];
}
