/**
 * Builds a full URL from base + endpoint, appending query params for GET/DELETE.
 *
 * @param base     - Base URL, e.g. "https://api-metrika.yandex.net"
 * @param endpoint - Must start with "/", e.g. "/stat/v1/data"
 * @param params   - Optional key/value map; undefined/null values are skipped;
 *                   array values are joined with a comma
 * @param method   - HTTP method; params appended only for GET and DELETE
 */
export function buildUrl(
  base: string,
  endpoint: string,
  params?: Record<string, unknown>,
  method?: string
): string {
  if (!endpoint.startsWith("/")) {
    throw new Error(`endpoint must start with "/", got: ${endpoint}`);
  }

  const url = base + endpoint;

  const appendParams =
    method === undefined || method === "GET" || method === "DELETE";

  if (!appendParams || !params) {
    return url;
  }

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      qs.set(key, value.join(","));
    } else {
      qs.set(key, String(value));
    }
  }

  const queryString = qs.toString();
  if (!queryString) return url;

  return url + "?" + queryString;
}
