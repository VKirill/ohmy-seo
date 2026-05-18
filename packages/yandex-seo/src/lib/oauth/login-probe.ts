import { fetch } from "undici";

const LOGIN_INFO_URL = "https://login.yandex.ru/info?format=json";
const WEBMASTER_USER_URL = "https://api.webmaster.yandex.net/v4/user";

export async function probeLogin(
  accessToken: string,
): Promise<{ login: string; display_name?: string; id?: string } | null> {
  const timeoutMs = parseInt(process.env.HTTP_TIMEOUT_MS ?? "30000", 10);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(LOGIN_INFO_URL, {
      headers: { Authorization: "OAuth " + accessToken },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    if (typeof data["login"] !== "string") return null;
    return {
      login: data["login"] as string,
      display_name:
        typeof data["display_name"] === "string"
          ? (data["display_name"] as string)
          : undefined,
      id: typeof data["id"] === "string" ? (data["id"] as string) : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeWebmasterUserId(
  accessToken: string,
): Promise<number | null> {
  const timeoutMs = parseInt(process.env.HTTP_TIMEOUT_MS ?? "30000", 10);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(WEBMASTER_USER_URL, {
      headers: { Authorization: "OAuth " + accessToken },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    if (typeof data["user_id"] !== "number") return null;
    return data["user_id"] as number;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
