/**
 * xmlstock-archive.ts — persistent raw-XML archival for historical retrieval.
 *
 * Storage: SQLite BLOB in same DB as usage-counter (MCP_XMLSTOCK_DB_PATH).
 * Compression: gzip (zlib built-in), ~5x ratio for XML payloads.
 *
 * PRIVACY: canonical_args must NEVER contain user/key credentials.
 */

import Database from "better-sqlite3";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// DB singleton (reuse same file as usage-counter)
// ---------------------------------------------------------------------------

const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data/xmlstock-usage.db");

let db: Database.Database | null = null;

function getArchiveDb(): Database.Database {
  if (db !== null) return db;
  const dbPath = process.env.MCP_XMLSTOCK_DB_PATH ?? DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS xmlstock_archive (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      engine         TEXT    NOT NULL,
      query          TEXT    NOT NULL,
      query_hash     TEXT    NOT NULL,
      canonical_args TEXT    NOT NULL,
      raw_xml_gz     BLOB    NOT NULL,
      raw_size_bytes INTEGER NOT NULL,
      http_status    INTEGER NOT NULL DEFAULT 200,
      fetched_at     TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_archive_engine_time
      ON xmlstock_archive(engine, fetched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_archive_query_hash
      ON xmlstock_archive(query_hash);
  `);
  return db;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a raw XML response to the archive.
 * Non-blocking: the caller should .catch() errors and console.warn.
 * canonical_args MUST NOT contain user/key credentials.
 */
export async function archiveRawXml(
  engine: "yandex" | "google",
  canonicalArgs: Record<string, unknown>,
  rawXml: string,
  httpStatus: number
): Promise<void> {
  const canonicalStr = JSON.stringify(canonicalArgs);
  const query = (canonicalArgs.query as string | undefined) ?? "";
  const queryHash = sha256(canonicalStr);
  const compressed = gzipSync(Buffer.from(rawXml, "utf-8"));

  getArchiveDb()
    .prepare(
      `INSERT INTO xmlstock_archive
         (engine, query, query_hash, canonical_args, raw_xml_gz, raw_size_bytes, http_status, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      engine,
      query,
      queryHash,
      canonicalStr,
      compressed,
      rawXml.length,
      httpStatus,
      new Date().toISOString()
    );
}

// ---------------------------------------------------------------------------
// Search metadata (no raw XML returned)
// ---------------------------------------------------------------------------

export type ArchiveMetaRow = {
  id: number;
  engine: string;
  query: string;
  fetched_at: string;
  raw_size_bytes: number;
  http_status: number;
};

export async function searchArchive(filters: {
  query?: string;
  engine?: "yandex" | "google";
  date_from?: string;
  date_to?: string;
  limit?: number;
}): Promise<ArchiveMetaRow[]> {
  const limit = Math.min(filters.limit ?? 50, 500);
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.engine) {
    conditions.push("engine = ?");
    params.push(filters.engine);
  }
  if (filters.query) {
    conditions.push("query LIKE ?");
    params.push(`%${filters.query}%`);
  }
  if (filters.date_from) {
    conditions.push("fetched_at >= ?");
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conditions.push("fetched_at <= ?");
    params.push(filters.date_to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `
    SELECT id, engine, query, fetched_at, raw_size_bytes, http_status
    FROM xmlstock_archive
    ${where}
    ORDER BY fetched_at DESC
    LIMIT ?
  `;

  return getArchiveDb()
    .prepare<(string | number)[], ArchiveMetaRow>(sql)
    .all(...params, limit);
}

// ---------------------------------------------------------------------------
// Fetch single archived record (with decompressed XML)
// ---------------------------------------------------------------------------

export type ArchiveFullRow = {
  id: number;
  engine: string;
  query: string;
  canonical_args: string;
  raw_xml: string;
  raw_size_bytes: number;
  http_status: number;
  fetched_at: string;
};

export async function getArchivedXml(id: number): Promise<ArchiveFullRow | null> {
  const row = getArchiveDb()
    .prepare<[number], {
      id: number;
      engine: string;
      query: string;
      canonical_args: string;
      raw_xml_gz: Buffer;
      raw_size_bytes: number;
      http_status: number;
      fetched_at: string;
    }>(
      `SELECT id, engine, query, canonical_args, raw_xml_gz, raw_size_bytes, http_status, fetched_at
       FROM xmlstock_archive WHERE id = ?`
    )
    .get(id);

  if (!row) return null;

  const rawXml = gunzipSync(row.raw_xml_gz).toString("utf-8");
  return {
    id: row.id,
    engine: row.engine,
    query: row.query,
    canonical_args: row.canonical_args,
    raw_xml: rawXml,
    raw_size_bytes: row.raw_size_bytes,
    http_status: row.http_status,
    fetched_at: row.fetched_at,
  };
}
