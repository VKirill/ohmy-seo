import path from "node:path";

// ---------------------------------------------------------------------------
// Per-package env prefixes
// Add entries here when new packages are created (mutagen, xmlstock, etc.)
// ---------------------------------------------------------------------------

const ENV_PREFIX_MAP: Record<string, string> = {
  "yandex-seo": "MCP_YANDEX_SEO",
  "mutagen":    "MCP_MUTAGEN",
  "xmlstock":   "MCP_XMLSTOCK",
};

export interface PackageConfig {
  /** Resolved AES master key — throws if the env var is missing or invalid. */
  masterKey: Buffer;
  /** Absolute path to the SQLite database file. */
  dbPath: string;
  /** Env prefix for this package, e.g. 'MCP_MUTAGEN'. */
  envPrefix: string;
}

/**
 * Resolve package-level config from environment variables.
 *
 * Reads `${PREFIX}_MASTER_KEY` and `${PREFIX}_DB_PATH` where PREFIX comes from
 * the internal map (yandex-seo → MCP_YANDEX_SEO, mutagen → MCP_MUTAGEN, etc.).
 * Unknown package names derive the prefix as MCP_<UPPER_UNDERSCORE>.
 *
 * Throws if the master key env var is absent or not a 64-hex-char string.
 */
export function resolvePackageConfig(packageName: string): PackageConfig {
  const envPrefix = ENV_PREFIX_MAP[packageName]
    ?? "MCP_" + packageName.toUpperCase().replace(/-/g, "_");

  const masterKeyEnv = `${envPrefix}_MASTER_KEY`;
  const dbPathEnv    = `${envPrefix}_DB_PATH`;

  const rawKey = process.env[masterKeyEnv] ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    throw new Error(
      `${masterKeyEnv} is missing or invalid (need 32 hex bytes / 64 hex chars). ` +
      `Generate one with: openssl rand -hex 32`,
    );
  }

  const defaultDbPath = path.resolve(process.cwd(), "data/state.db");
  const dbPath = process.env[dbPathEnv] || defaultDbPath;

  return {
    masterKey: Buffer.from(rawKey, "hex"),
    dbPath,
    envPrefix,
  };
}
