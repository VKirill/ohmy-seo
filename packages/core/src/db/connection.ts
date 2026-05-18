import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "./migrations.js";
import { resolvePackageConfig } from "../config/package-config.js";

// ---------------------------------------------------------------------------
// Package-aware Database cache
// ---------------------------------------------------------------------------
//
// getDb(packageName?) opens a Database for the given package and caches it.
// Zero-args defaults to 'yandex-seo' for full backward compatibility.
//
// Named packages (e.g. 'mutagen', 'xmlstock', 'google-search-console') each
// get their own Database instance, isolated from the legacy singleton.
//
// The legacy zero-arg path avoids calling resolvePackageConfig (which
// requires a master key) so that shared infrastructure — e.g. query-cache-repo
// called by withCache — continues to work in any package context without
// requiring MCP_YANDEX_SEO_MASTER_KEY.

const _dbs = new Map<string, Database.Database>();

/** Resolve db path for the legacy zero-arg default without master key check. */
function legacyDbPath(): string {
  return (
    process.env["MCP_YANDEX_SEO_DB_PATH"] ||
    path.resolve(process.cwd(), "data/state.db")
  );
}

function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  fs.chmodSync(dbPath, 0o600);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  applyMigrations(db);
  return db;
}

export function getDb(packageName?: string): Database.Database {
  const pkg = packageName ?? "yandex-seo"; // legacy default — back-compat

  if (_dbs.has(pkg)) {
    return _dbs.get(pkg)!;
  }

  // Named packages use resolvePackageConfig to pick up ${PREFIX}_DB_PATH.
  // Zero-arg (pkg === 'yandex-seo' via default) uses the legacy direct env
  // read so shared infrastructure never requires MCP_YANDEX_SEO_MASTER_KEY.
  const dbPath =
    packageName !== undefined
      ? resolvePackageConfig(pkg).dbPath
      : legacyDbPath();

  const db = openDb(dbPath);
  _dbs.set(pkg, db);
  return db;
}

/**
 * Close and evict the cached Database instance for a package.
 * Primarily used in tests for cleanup.
 * Zero-args closes the default 'yandex-seo' instance.
 */
export function closeDb(packageName?: string): void {
  const pkg = packageName ?? "yandex-seo";
  const db = _dbs.get(pkg);
  if (db) {
    db.close();
    _dbs.delete(pkg);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const database = getDb();
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();
  console.log("tables:", tables); // guardian: allow
  console.log("user_version:", database.pragma("user_version", { simple: true })); // guardian: allow
}
