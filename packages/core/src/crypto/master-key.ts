const FALLBACK_ENV = "MCP_YANDEX_SEO_MASTER_KEY";

let cachedKey: Buffer | null = null;
let activeEnv: string | null = null;

/**
 * Registers which env var holds this process's master key.
 *
 * Called by resolvePackageConfig() at start-up. Without it every package fell
 * back to MCP_YANDEX_SEO_MASTER_KEY, so mcp-gsc, mcp-ga4 and mcp-gtm ignored
 * their documented MCP_GSC_MASTER_KEY / MCP_GA4_MASTER_KEY / MCP_GTM_MASTER_KEY
 * and failed to decrypt anything unless the Yandex variable happened to be set.
 */
export function setMasterKeyEnv(envName: string): void {
  if (activeEnv !== envName) {
    activeEnv = envName;
    cachedKey = null;
  }
}

export function getMasterKey(): Buffer {
  if (cachedKey !== null) {
    return cachedKey;
  }

  const envName = activeEnv ?? FALLBACK_ENV;
  const raw = process.env[envName] ?? "";

  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      `${envName} is missing or invalid (need 32 hex bytes / 64 hex chars). ` +
      "Generate one with: openssl rand -hex 32",
    );
  }

  cachedKey = Buffer.from(raw, "hex");
  return cachedKey;
}
