import { promises as fsp } from "fs";
import { existsSync } from "fs";

export type LedgerState = "pending" | "committed" | "failed";

export interface LedgerEntry {
  state: LedgerState;
  op: string;             // e.g. "campaign", "ad_group", "keyword", "ad_tgo", "ad_rsya", "image"
  signature: string;      // deterministic, e.g. "campaign:phase-3-5-c-test_search_1234"
  cluster_id?: string;
  returned_id?: number | string;  // numeric for entities, string for image hash
  parent_id?: number;     // e.g. for adgroup → campaign_id
  error?: unknown;
  ts: string;             // ISO 8601
}

export interface Ledger {
  path: string;
  writePending(entry: Omit<LedgerEntry, "state" | "ts">): Promise<void>;
  writeCommitted(signature: string, returned_id: number | string, parent_id?: number): Promise<void>;
  writeFailed(signature: string, error: unknown): Promise<void>;
  readAll(): Promise<LedgerEntry[]>;
  findUnresolvedPending(): Promise<LedgerEntry[]>;  // pending entries with no later committed/failed for same signature
  close(): Promise<void>;
}

export async function openLedger(path: string): Promise<Ledger> {
  // Create file if not exists. Append mode.
  const fh = await fsp.open(path, "a+");

  async function append(entry: LedgerEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    await fh.write(line);
    await fh.sync();  // CRITICAL — fsync before next operation
  }

  return {
    path,
    async writePending(entry) {
      await append({ ...entry, state: "pending", ts: new Date().toISOString() });
    },
    async writeCommitted(signature, returned_id, parent_id) {
      await append({
        state: "committed",
        op: "", // op is implied by signature prefix
        signature,
        returned_id,
        parent_id,
        ts: new Date().toISOString(),
      });
    },
    async writeFailed(signature, error: unknown) {
      const errStr = error instanceof Error ? error.message : JSON.stringify(error);
      await append({
        state: "failed",
        op: "",
        signature,
        error: errStr,
        ts: new Date().toISOString(),
      });
    },
    async readAll() {
      const text = await fsp.readFile(path, "utf-8");
      return text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as LedgerEntry);
    },
    async findUnresolvedPending() {
      const text = await fsp.readFile(path, "utf-8");
      const all: LedgerEntry[] = text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as LedgerEntry);
      const resolved = new Set<string>();
      for (const e of all) {
        if (e.state === "committed" || e.state === "failed") resolved.add(e.signature);
      }
      return all.filter(e => e.state === "pending" && !resolved.has(e.signature));
    },
    async close() {
      await fh.close();
    },
  };
}
