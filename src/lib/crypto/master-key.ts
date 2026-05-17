const MISSING_OR_INVALID_MSG =
  "MCP_YANDEX_SEO_MASTER_KEY is missing or invalid (need 32 hex bytes / 64 hex chars). " +
  "Generate one with: openssl rand -hex 32";

let cachedKey: Buffer | null = null;

export function getMasterKey(): Buffer {
  if (cachedKey !== null) {
    return cachedKey;
  }

  const raw = process.env.MCP_YANDEX_SEO_MASTER_KEY ?? "";

  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(MISSING_OR_INVALID_MSG);
  }

  cachedKey = Buffer.from(raw, "hex");
  return cachedKey;
}
