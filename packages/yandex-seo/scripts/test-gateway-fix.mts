import { readFileSync } from "fs";
const cfg = JSON.parse(readFileSync(`${process.env.HOME}/.claude.json`, "utf8"));
process.env.MCP_YANDEX_SEO_MASTER_KEY = cfg.mcpServers["mcp-yandex-seo"].env.MCP_YANDEX_SEO_MASTER_KEY;
process.env.MCP_YANDEX_SEO_DB_PATH = cfg.mcpServers["mcp-yandex-seo"].env.MCP_YANDEX_SEO_DB_PATH;

const { runYandexDirectApi } = await import("/home/ubuntu/tools/ohmy-seo/packages/yandex-seo/src/tools/yandex-direct-api.js");

const PAYLOAD = { method: "get", params: { SelectionCriteria: {}, FieldNames: ["Id","Name"], Page: { Limit: 5 } } };

console.log("=== Test 1: correct usage — payload in body ===");
const t1 = await runYandexDirectApi({ // guardian: allow — test script, runtime MCP response shape
  endpoint: "/json/v5/campaigns",
  body: PAYLOAD,
  account: "yandex-direct-prod-main",
});
const t1Content = t1.content[0] as { type: string; text: string }; // guardian: allow — MCP content union, text variant confirmed by type field
const t1Parsed = JSON.parse(t1Content.text) as Record<string, unknown>;
console.log("status:", t1Parsed["status"], "ok:", t1Parsed["ok"]);
const t1Data = t1Parsed["data"] as Record<string, unknown> | undefined;
const t1Result = t1Data?.["result"] as Record<string, unknown> | undefined;
const t1Campaigns = t1Result?.["Campaigns"] as unknown[] | undefined;
console.log("Campaigns:", t1Campaigns?.length ?? 0);

console.log("\n=== Test 2: buggy usage — payload in params, auto-promotion should kick in ===");
const t2 = await runYandexDirectApi({ // guardian: allow — test script, runtime MCP response shape
  endpoint: "/json/v5/campaigns",
  params: PAYLOAD,  // ← intentionally wrong field
  account: "yandex-direct-prod-main",
});
const t2Content = t2.content[0] as { type: string; text: string }; // guardian: allow — MCP content union, text variant confirmed by type field
const t2Parsed = JSON.parse(t2Content.text) as Record<string, unknown>;
console.log("status:", t2Parsed["status"], "ok:", t2Parsed["ok"]);
console.log("_note:", t2Parsed["_note"] ?? "(missing — fix not working)");
const t2Data = t2Parsed["data"] as Record<string, unknown> | undefined;
const t2Result = t2Data?.["result"] as Record<string, unknown> | undefined;
const t2Campaigns = t2Result?.["Campaigns"] as unknown[] | undefined;
console.log("Campaigns:", t2Campaigns?.length ?? 0);

if (t1Parsed["ok"] && t2Parsed["ok"] && t2Parsed["_note"]) {
  console.log("\n✅ FIX VERIFIED: both calls return 200, auto-promotion noted.");
  process.exit(0);
} else {
  console.error("\n❌ FIX FAILED");
  process.exit(1);
}
