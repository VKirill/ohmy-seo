import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "./migrations.js";

const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data/state.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db !== null) {
    return db;
  }

  const dbPath = process.env.MCP_YANDEX_SEO_DB_PATH ?? DEFAULT_DB_PATH;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);

  fs.chmodSync(dbPath, 0o600);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");

  applyMigrations(db);

  return db;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const database = getDb();
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();
  console.log("tables:", tables); // guardian: allow
  console.log("user_version:", database.pragma("user_version", { simple: true })); // guardian: allow
}
