import * as fs from "fs";
import * as crypto from "crypto";

export interface ClusterRow {
  cluster_id: string;
  marker_query: string;
  query: string;
  intent: "informational" | "transactional" | "branded" | "navigational" | string;
  frequency: number;
  frequency_exact: number;
  frequency_strict: number;
  raw: Record<string, string>;
}

export interface ParsedCsv {
  clusters: Map<string, ClusterRow[]>;
  total_rows: number;
  total_clusters: number;
  sha256: string;
  encoding_used: "utf-8-sig" | "cp1251";
}

const REQUIRED_HEADERS = ["Кластер", "Маркерный запрос", "Запрос", "Тип"];

function looksGarbled(text: string): boolean {
  // cp1251 decoded as utf-8 produces Ð and Ñ for Cyrillic
  const sample = text.slice(0, 200);
  const garbledCount = (sample.match(/[ÐÑ]/g) ?? []).length;
  return garbledCount > 3;
}

function decodeBuffer(buffer: Buffer): { text: string; encoding_used: "utf-8-sig" | "cp1251" } {
  const utf8 = buffer.toString("utf8");
  // Strip BOM (U+FEFF = EF BB BF)
  const stripped = utf8.startsWith("﻿") ? utf8.slice(1) : utf8;

  if (!looksGarbled(stripped)) {
    return { text: stripped, encoding_used: "utf-8-sig" };
  }

  // Fall back to windows-1251
  const decoded = new TextDecoder("windows-1251").decode(buffer);
  return { text: decoded, encoding_used: "cp1251" };
}

function parseNumber(raw: string): number {
  if (!raw || raw.trim() === "") return 0;
  // Russian locale uses comma as decimal separator
  const normalized = raw.trim().replace(",", ".");
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

export function parseKeyCollectorCsv(file_path: string): ParsedCsv {
  const buffer = fs.readFileSync(file_path);

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  const { text, encoding_used } = decodeBuffer(buffer);

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");

  if (lines.length < 2) {
    throw new Error("CSV file is empty or has no data rows");
  }

  const headers = lines[0].split(";");

  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      throw new Error(
        `CSV header missing required column: "${required}". Found: ${headers.join(", ")}`
      );
    }
  }

  const idx = {
    cluster_id: headers.indexOf("Кластер"),
    marker_query: headers.indexOf("Маркерный запрос"),
    query: headers.indexOf("Запрос"),
    intent: headers.indexOf("Тип"),
    frequency: headers.indexOf("Частотность"),
    frequency_exact: headers.indexOf("Частотность «!»"),
    frequency_strict: headers.indexOf("Частотность «[!]»"),
  };

  const clusters = new Map<string, ClusterRow[]>();

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(";");

    const raw: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      raw[headers[j]] = cells[j] ?? "";
    }

    const row: ClusterRow = {
      cluster_id: cells[idx.cluster_id]?.trim() ?? "",
      marker_query: cells[idx.marker_query]?.trim() ?? "",
      query: cells[idx.query]?.trim() ?? "",
      intent: cells[idx.intent]?.trim() ?? "",
      frequency: parseNumber(cells[idx.frequency]),
      frequency_exact: parseNumber(cells[idx.frequency_exact]),
      frequency_strict: parseNumber(cells[idx.frequency_strict]),
      raw,
    };

    const existing = clusters.get(row.cluster_id);
    if (existing) {
      existing.push(row);
    } else {
      clusters.set(row.cluster_id, [row]);
    }
  }

  return {
    clusters,
    total_rows: lines.length - 1,
    total_clusters: clusters.size,
    sha256,
    encoding_used,
  };
}
