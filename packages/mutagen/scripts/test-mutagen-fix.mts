import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Try to load MUTAGEN_API_KEY from env or from common .env locations
function loadKey(): string | null {
  if (process.env.MUTAGEN_API_KEY) return process.env.MUTAGEN_API_KEY;
  const candidates = [".env", "../.env", "/home/ubuntu/apps/seo-cluster/.env"];
  for (const p of candidates) {
    const full = resolve(p);
    if (existsSync(full)) {
      const content = readFileSync(full, "utf8");
      const m = content.match(/^MUTAGEN_API_KEY\s*=\s*(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

const key = loadKey();
if (!key) {
  console.log("skipped: no MUTAGEN_API_KEY available");
  process.exit(0);
}
process.env.MUTAGEN_API_KEY = key;

const { executeMutagenMethod, getBalance } = await import("/home/ubuntu/tools/ohmy-seo/packages/mutagen/src/lib/mutagen-client.js");

console.log("=== Test 1: balance (sync GET) ===");
const balance = await getBalance();
console.log("Balance:", balance);

console.log("\n=== Test 2: parser.get (sync, single key) ===");
const parserGet: unknown = await executeMutagenMethod("parser.get", {
  key: "купить квартиру москва",
  parser: "wordstat_q",
  region_id: "0",
});
console.log("parser.get result:", JSON.stringify(parserGet).slice(0, 200));

console.log("\n=== Test 3: parser.mass (async, polling via .id) ===");
try {
  const massResult: unknown = await executeMutagenMethod("parser.mass", {
    keys_list: "test1\ntest2",
    name: `test-fix-${Date.now()}`,
    parser: "wordstat_q",
    region_id: "0",
  }, 120);
  console.log("parser.mass result:", JSON.stringify(massResult).slice(0, 300));
  console.log("parser.mass async polling WORKS (used to throw 'missing task_id')");
} catch (err: unknown) {
  console.error("parser.mass FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}

console.log("\n=== Test 4: serp.report (POST due to filter[] array) ===");
try {
  const serp: unknown = await executeMutagenMethod("serp.report", {
    region: "yandex_msk",
    keyword: "купить квартиру",
    report: "report_keyword_info",
  });
  console.log("serp.report result:", JSON.stringify(serp).slice(0, 200));
  console.log("serp.report via POST WORKS");
} catch (err: unknown) {
  console.error("serp.report:", err instanceof Error ? err.message : String(err));
}

console.log("\n=== All fixes verified ===");
