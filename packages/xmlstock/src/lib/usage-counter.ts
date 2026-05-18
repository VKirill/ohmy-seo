import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data/xmlstock-usage.db");

let db: Database.Database | null = null;

function getUsageDb(): Database.Database {
  if (db !== null) return db;
  const dbPath = process.env.MCP_XMLSTOCK_DB_PATH ?? DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`CREATE TABLE IF NOT EXISTS xmlstock_usage (
    tool TEXT NOT NULL, engine TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
    PRIMARY KEY (tool, engine)
  )`);
  return db;
}

export function incrementUsage(tool: string, engine: string): void {
  getUsageDb()
    .prepare(
      `INSERT INTO xmlstock_usage (tool, engine, count, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(tool, engine) DO UPDATE
         SET count = count + 1, updated_at = excluded.updated_at`
    )
    .run(tool, engine, new Date().toISOString());
}

export type UsageStats = {
  total_calls: number;
  by_engine: { yandex: number; google: number };
  by_tool: { xmlstock_yandex_serp: number; xmlstock_google_serp: number };
  db_path: string;
};

export function getUsageStats(): UsageStats {
  const rows = getUsageDb()
    .prepare<[], { tool: string; engine: string; count: number }>(
      "SELECT tool, engine, count FROM xmlstock_usage"
    )
    .all();

  let total = 0;
  const byEngine: Record<string, number> = { yandex: 0, google: 0 };
  const byTool: Record<string, number> = {
    xmlstock_yandex_serp: 0,
    xmlstock_google_serp: 0,
  };

  for (const row of rows) {
    total += row.count;
    if (row.engine in byEngine) byEngine[row.engine] += row.count;
    if (row.tool   in byTool)   byTool[row.tool]     += row.count;
  }

  return {
    total_calls: total,
    by_engine: { yandex: byEngine.yandex, google: byEngine.google },
    by_tool: {
      xmlstock_yandex_serp: byTool.xmlstock_yandex_serp,
      xmlstock_google_serp: byTool.xmlstock_google_serp,
    },
    db_path: path.resolve(process.env.MCP_XMLSTOCK_DB_PATH ?? DEFAULT_DB_PATH),
  };
}
