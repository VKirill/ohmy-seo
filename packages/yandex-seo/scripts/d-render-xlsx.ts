/**
 * d-render-xlsx.ts — Render YAML campaign bundle to xlsx for Phase 3.5.D smoke test.
 */

import { readFileSync } from "fs";
import * as nodePath from "path";

const claudeJsonPath = nodePath.join(process.env["HOME"] ?? "/root", ".claude.json");
const cfg = JSON.parse(readFileSync(claudeJsonPath, "utf8")) as {
  mcpServers: Record<string, { env: Record<string, string> }>;
};
process.env["MCP_YANDEX_SEO_MASTER_KEY"] =
  cfg.mcpServers["mcp-yandex-seo"].env["MCP_YANDEX_SEO_MASTER_KEY"];
process.env["MCP_YANDEX_SEO_DB_PATH"] =
  cfg.mcpServers["mcp-yandex-seo"].env["MCP_YANDEX_SEO_DB_PATH"];

import { runDirectRenderToXlsx } from "../src/tools/direct-render-to-xlsx.js";

const folderArg = process.argv[2] ?? "campaigns-draft/test-vechkasov-edu-d";

const r = await runDirectRenderToXlsx({ folder: folderArg });
const rawText = (r.content[0] as { type: string; text: string }).text;
let result: unknown;
try {
  result = JSON.parse(rawText);
} catch {
  console.error("Failed to parse output:", rawText);
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
