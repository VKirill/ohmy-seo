import { createClient, type RedisClientType } from "redis";

declare global {
  // eslint-disable-next-line no-var
  var __ohmyRedis: RedisClientType | undefined;
}

/**
 * Cache only. Everything here is reconstructible from Postgres, so a cold or
 * missing Redis degrades latency and never correctness — that is what keeps
 * the stack portable to a VPS where Redis was wiped.
 */
function client(): RedisClientType {
  if (!global.__ohmyRedis) {
    const c: RedisClientType = createClient({ url: process.env.REDIS_URL ?? "redis://redis:6379" });
    c.on("error", (e) => console.error("[redis]", e.message));
    void c.connect();
    global.__ohmyRedis = c;
  }
  return global.__ohmyRedis;
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await client().get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await client().set(key, value, { EX: ttlSeconds });
  } catch {
    /* cache is best-effort */
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await client().del(key);
  } catch {
    /* cache is best-effort */
  }
}
