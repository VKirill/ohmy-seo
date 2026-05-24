/**
 * Yandex Direct API v5 — READ-only coverage smoke test.
 *
 * Exercises all major Direct v5 services with read methods to validate
 * the gateway POST fix (TASK-3520/3521/3522). Saves a markdown coverage
 * matrix to docs/plans/phase-3-5-b-direct-api-coverage/coverage-matrix.md.
 *
 * Usage:
 *   npx tsx packages/yandex-seo/scripts/direct-coverage-smoke.ts
 *
 * Required env:
 *   MCP_YANDEX_SEO_MASTER_KEY — 64-char hex, loaded from ~/.claude.json if not set
 *   MCP_YANDEX_SEO_DB_PATH    — path to SQLite DB
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Bootstrap: load env from ~/.claude.json if master key not already set
// ---------------------------------------------------------------------------

function bootstrapEnv(): void {
  if (process.env["MCP_YANDEX_SEO_MASTER_KEY"] && process.env["MCP_YANDEX_SEO_DB_PATH"]) {
    return; // already set
  }
  const claudeJson = path.join(process.env["HOME"] ?? "/root", ".claude.json");
  if (!fs.existsSync(claudeJson)) return;
  try {
    const raw = fs.readFileSync(claudeJson, "utf-8");
    const cfg = JSON.parse(raw) as {
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    const env = cfg?.mcpServers?.["mcp-yandex-seo"]?.env ?? {};
    for (const [k, v] of Object.entries(env)) {
      if (!process.env[k]) {
        process.env[k] = v;
      }
    }
  } catch {
    // best-effort; fail later at validation
  }
}

bootstrapEnv();

// Validate master key before any DB import
const masterKey = process.env["MCP_YANDEX_SEO_MASTER_KEY"] ?? "";
if (!/^[0-9a-fA-F]{64}$/.test(masterKey)) {
  process.stderr.write(
    "[smoke] FATAL: MCP_YANDEX_SEO_MASTER_KEY is missing or invalid.\n" +
      "[smoke] It must be a 64-char hex string.\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Now safe to import DB-dependent modules
// ---------------------------------------------------------------------------

import { executeApiCall } from "../src/lib/api-gateway.js";
import { listAccounts } from "../src/lib/db/accounts-repo.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceResult {
  service: string;
  method: string;
  status: "OK" | "ERROR" | "SKIPPED";
  httpStatus?: number;
  errorCode?: string | number;
  entityCount?: number;
  latencyMs: number;
  snippet: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT = "yandex-direct-prod-main";
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const MATRIX_PATH = path.join(
  REPO_ROOT,
  "docs",
  "plans",
  "phase-3-5-b-direct-api-coverage",
  "coverage-matrix.md"
);

function log(msg: string): void {
  process.stderr.write("[smoke] " + msg + "\n");
}

function snippet(data: unknown, maxLen = 200): string {
  const s = JSON.stringify(data) ?? "";
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

/** Call a Direct v5 service. Returns timing + parsed result. */
async function callDirect(
  service: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const result = await executeApiCall({
    apiName: "direct",
    endpoint: `/json/v5/${service}`,
    // No method: gateway defaults to POST per spec (the fix under test)
    body,
    account: ACCOUNT,
  });
  if (result.ok) {
    return { ok: true, status: result.status, data: result.data };
  }
  return { ok: false, status: result.status, data: result.body };
}

/** Run one service test, capture timing and result. */
async function testService(
  service: string,
  apiMethod: string,
  params: Record<string, unknown>,
  skipReason?: string
): Promise<ServiceResult> {
  if (skipReason) {
    return {
      service,
      method: apiMethod,
      status: "SKIPPED",
      latencyMs: 0,
      snippet: "",
      note: skipReason,
    };
  }

  const t0 = Date.now();
  try {
    const body: Record<string, unknown> = { method: apiMethod, params };
    const res = await callDirect(service, body);
    const latencyMs = Date.now() - t0;

    if (res.ok) {
      const data = res.data as Record<string, unknown> | null;
      // Direct wraps results in a "result" key
      const inner = (data as Record<string, unknown> | null)?.result as
        | Record<string, unknown>
        | null
        | undefined;
      // Count entities from common response shapes
      let entityCount: number | undefined;
      if (inner) {
        for (const key of Object.keys(inner)) {
          const val = inner[key];
          if (Array.isArray(val)) {
            entityCount = val.length;
            break;
          }
        }
      }
      return {
        service,
        method: apiMethod,
        status: "OK",
        httpStatus: res.status,
        entityCount,
        latencyMs,
        snippet: snippet(inner ?? data),
      };
    } else {
      // Error response
      const errBody = res.data as Record<string, unknown> | null;
      const errorCode =
        (errBody as Record<string, unknown> | null)?.error_code ??
        (errBody as Record<string, unknown> | null)?.code ??
        res.status;
      const errorText = snippet(errBody);
      return {
        service,
        method: apiMethod,
        status: "ERROR",
        httpStatus: res.status,
        errorCode: String(errorCode),
        latencyMs,
        snippet: errorText,
      };
    }
  } catch (e) {
    const latencyMs = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    return {
      service,
      method: apiMethod,
      status: "ERROR",
      latencyMs,
      snippet: msg.slice(0, 200),
      note: "exception thrown",
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log("Yandex Direct v5 READ coverage smoke starting");

  // Verify account exists
  const accounts = listAccounts();
  const acc = accounts.find((a) => a.label === ACCOUNT);
  if (!acc) {
    log(`FATAL: account '${ACCOUNT}' not found in DB.`);
    log(`Available accounts: ${accounts.map((a) => a.label).join(", ") || "(none)"}`);
    process.exit(1);
  }
  log(`Using account: ${acc.label} (login=${acc.yandex_login ?? "unknown"})`);

  const results: ServiceResult[] = [];

  // 1. campaigns
  log("→ campaigns");
  const campaignsResult = await testService("campaigns", "get", {
    SelectionCriteria: {},
    FieldNames: ["Id", "Name", "Type", "Status"],
  });
  results.push(campaignsResult);

  // Collect campaign IDs for dependent tests
  let campaignIds: number[] = [];
  if (campaignsResult.status === "OK") {
    const inner = (() => {
      try {
        return JSON.parse(campaignsResult.snippet.replace("…", "")) as
          | Record<string, unknown>
          | null
          | undefined;
      } catch {
        return null;
      }
    })();
    // Re-fetch properly for IDs
    try {
      const raw = await callDirect("campaigns", {
        method: "get",
        params: { SelectionCriteria: {}, FieldNames: ["Id", "Name", "Type", "Status"] },
      });
      if (raw.ok) {
        const result = (raw.data as Record<string, unknown>)?.result as
          | Record<string, unknown>
          | undefined;
        const camps = result?.Campaigns as Array<{ Id: number }> | undefined;
        if (Array.isArray(camps)) {
          campaignIds = camps.map((c) => c.Id);
        }
      }
      void inner; // suppress unused warning
    } catch {
      // non-fatal, continue with empty IDs
    }
  }
  log(`  campaigns: ${campaignsResult.status}, ids found: ${campaignIds.length}`);

  // 2. adgroups — requires CampaignIds
  log("→ adgroups");
  let adGroupIds: number[] = [];
  if (campaignIds.length === 0) {
    results.push(
      await testService("adgroups", "get", {}, "No campaign IDs from step 1 — skipping")
    );
  } else {
    const adgroupsResult = await testService("adgroups", "get", {
      SelectionCriteria: { CampaignIds: campaignIds },
      FieldNames: ["Id", "Name", "CampaignId", "Status"],
    });
    results.push(adgroupsResult);
    if (adgroupsResult.status === "OK") {
      try {
        const raw = await callDirect("adgroups", {
          method: "get",
          params: {
            SelectionCriteria: { CampaignIds: campaignIds },
            FieldNames: ["Id", "Name", "CampaignId", "Status"],
          },
        });
        if (raw.ok) {
          const result = (raw.data as Record<string, unknown>)?.result as
            | Record<string, unknown>
            | undefined;
          const groups = result?.AdGroups as Array<{ Id: number }> | undefined;
          if (Array.isArray(groups)) {
            adGroupIds = groups.map((g) => g.Id);
          }
        }
      } catch {
        // non-fatal
      }
    }
    log(`  adgroups: ${adgroupsResult.status}, ids found: ${adGroupIds.length}`);
  }

  // 3. ads — requires AdGroupIds
  log("→ ads");
  if (adGroupIds.length === 0) {
    results.push(
      await testService("ads", "get", {}, "No adgroup IDs from step 2 — skipping")
    );
  } else {
    const adsResult = await testService("ads", "get", {
      SelectionCriteria: { AdGroupIds: adGroupIds },
      FieldNames: ["Id", "AdGroupId", "Status", "Type"],
    });
    results.push(adsResult);
    log(`  ads: ${adsResult.status}`);
  }

  // 4. keywords — requires AdGroupIds
  log("→ keywords");
  if (adGroupIds.length === 0) {
    results.push(
      await testService("keywords", "get", {}, "No adgroup IDs from step 2 — skipping")
    );
  } else {
    const kwResult = await testService("keywords", "get", {
      SelectionCriteria: { AdGroupIds: adGroupIds },
      FieldNames: ["Id", "AdGroupId", "Keyword", "Status"],
    });
    results.push(kwResult);
    log(`  keywords: ${kwResult.status}`);
  }

  // 5. sitelinks — Ids: [] may return error or empty
  log("→ sitelinks");
  const sitelinksResult = await testService("sitelinks", "get", {
    SelectionCriteria: {},
    FieldNames: ["Id", "Sitelinks"],
  });
  results.push(sitelinksResult);
  log(`  sitelinks: ${sitelinksResult.status}`);

  // 6. adimages
  log("→ adimages");
  const adimagesResult = await testService("adimages", "get", {
    SelectionCriteria: {},
    FieldNames: ["AdImageHash", "OriginalUrl", "Name"],
  });
  results.push(adimagesResult);
  log(`  adimages: ${adimagesResult.status}`);

  // 7. changes — checkDictionaries (no params object required)
  log("→ changes");
  const changesResult = await testService("changes", "checkDictionaries", {
    CheckIntervals: [
      {
        Field: "CAMPAIGNS",
        DateTimeInterval: {
          From: new Date(Date.now() - 3600 * 1000).toISOString().replace(/\.\d+Z$/, "+00:00"),
          To: new Date().toISOString().replace(/\.\d+Z$/, "+00:00"),
        },
      },
    ],
  });
  results.push(changesResult);
  log(`  changes: ${changesResult.status}`);

  // 8. retargetinglists
  log("→ retargetinglists");
  const retargetingResult = await testService("retargetinglists", "get", {
    SelectionCriteria: {},
    FieldNames: ["Id", "Name", "Type"],
  });
  results.push(retargetingResult);
  log(`  retargetinglists: ${retargetingResult.status}`);

  // 9. dictionaries — get with DictionaryNames
  log("→ dictionaries");
  const dictResult = await testService("dictionaries", "get", {
    DictionaryNames: ["Currencies", "TimeZones"],
  });
  results.push(dictResult);
  log(`  dictionaries: ${dictResult.status}`);

  // 10. clients
  log("→ clients");
  const clientsResult = await testService("clients", "get", {
    FieldNames: ["AccountQuality", "ClientInfo", "Login"],
  });
  results.push(clientsResult);
  log(`  clients: ${clientsResult.status}`);

  // ---------------------------------------------------------------------------
  // Build coverage matrix
  // ---------------------------------------------------------------------------

  const okCount = results.filter((r) => r.status === "OK").length;
  const errCount = results.filter((r) => r.status === "ERROR").length;
  const skipCount = results.filter((r) => r.status === "SKIPPED").length;

  const now = new Date().toISOString();

  const rows = results.map((r) => {
    const statusCell =
      r.status === "OK"
        ? `OK (${r.entityCount ?? "?"} entities)`
        : r.status === "SKIPPED"
          ? `SKIPPED`
          : `ERROR ${r.errorCode ?? r.httpStatus ?? "?"}`;

    const latencyCell = r.latencyMs > 0 ? `${r.latencyMs}ms` : "—";
    const noteCell = r.note ?? "";
    const snippetCell = r.snippet.replace(/\|/g, "\\|").slice(0, 120);

    return `| \`${r.service}\` | \`${r.method}\` | ${statusCell} | ${latencyCell} | ${noteCell} | ${snippetCell} |`;
  });

  const matrix = [
    `# Yandex Direct API v5 — Read Coverage Matrix`,
    ``,
    `Generated: ${now}`,
    `Account: \`${ACCOUNT}\``,
    ``,
    `**Summary:** ${okCount} OK / ${errCount} errors / ${skipCount} skipped`,
    ``,
    `| Service | Method | Status | Latency | Note | Response snippet |`,
    `|---|---|---|---|---|---|`,
    ...rows,
    ``,
  ].join("\n");

  // Print to stdout
  process.stdout.write(matrix + "\n");

  // Save to file
  fs.mkdirSync(path.dirname(MATRIX_PATH), { recursive: true });
  fs.writeFileSync(MATRIX_PATH, matrix, "utf-8");
  log(`Coverage matrix saved to ${MATRIX_PATH}`);

  log(`\n=== Summary: ${okCount} OK, ${errCount} errors, ${skipCount} skipped ===`);

  // Exit 0 even if some services errored — smoke is informational
  process.exit(0);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  log("FATAL: " + msg.slice(0, 300));
  process.exit(1);
});
