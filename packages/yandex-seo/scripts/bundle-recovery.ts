/**
 * bundle-recovery.ts — Standalone cleanup script for Yandex Direct orphan resources.
 *
 * Reads a bundle ledger file and cleans up all resources owned by that run from
 * Yandex Direct. Used after a pipeline crash to recover orphan resources, or
 * manually after test runs.
 *
 * Usage:
 *   npx tsx packages/yandex-seo/scripts/bundle-recovery.ts --ledger <path> [--dry-run] [--account <label>]
 *
 * Exit codes:
 *   0 — success (or dry-run completed)
 *   2 — ledger file not found
 *   3 — account resolution failed
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Bootstrap: load env BEFORE any DB-dependent import
// ---------------------------------------------------------------------------

function bootstrapEnv(): void {
  if (process.env["MCP_YANDEX_SEO_MASTER_KEY"] && process.env["MCP_YANDEX_SEO_DB_PATH"]) {
    return;
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
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // best-effort
  }
}

bootstrapEnv();

// ---------------------------------------------------------------------------
// CLI args (simple manual parsing — no external deps)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  ledger: string | undefined;
  dryRun: boolean;
  account: string | undefined;
} {
  let ledger: string | undefined;
  let dryRun = false;
  let account: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ledger" && argv[i + 1]) {
      ledger = argv[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--account" && argv[i + 1]) {
      account = argv[++i];
    }
  }

  return { ledger, dryRun, account };
}

const args = parseArgs(process.argv);

if (!args.ledger) {
  process.stderr.write("[bundle-recovery] ERROR: --ledger <path> is required.\n");
  process.stderr.write("Usage: npx tsx bundle-recovery.ts --ledger <path> [--dry-run] [--account <label>]\n");
  process.exit(1);
}

const LEDGER_PATH = path.resolve(args.ledger);
const DRY_RUN = args.dryRun;
const ACCOUNT = args.account;
const REPORT_PATH = LEDGER_PATH + ".recovery-report.md";

if (!fs.existsSync(LEDGER_PATH)) {
  process.stderr.write(`[bundle-recovery] ERROR: Ledger file not found: ${LEDGER_PATH}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Safe to import DB-dependent modules now
// ---------------------------------------------------------------------------

import { openLedger, type LedgerEntry } from "../src/lib/bundle-ledger.js";
import { executeApiCall } from "../src/lib/api-gateway.js";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stdout.write(`[bundle-recovery] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Direct API helpers (soft-fail on error)
// ---------------------------------------------------------------------------

async function directGet(
  endpoint: string,
  body: unknown,
  account?: string
): Promise<unknown> {
  const res = await executeApiCall({
    apiName: "direct",
    endpoint,
    method: "POST",
    body,
    account,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.data;
}

async function directDelete(
  endpoint: string,
  ids: number[],
  account?: string,
  softFailLog?: string[]
): Promise<void> {
  if (ids.length === 0) return;
  try {
    const res = await executeApiCall({
      apiName: "direct",
      endpoint,
      method: "POST",
      body: { method: "delete", params: { SelectionCriteria: { Ids: ids } } },
      account,
    });
    if (!res.ok) {
      const msg = `delete ${endpoint} ids=[${ids.join(",")}]: HTTP ${res.status}`;
      softFailLog?.push(msg);
      log(`  WARN: ${msg}`);
    } else {
      log(`  Deleted ${ids.length} item(s) from ${endpoint}: [${ids.join(", ")}]`);
    }
  } catch (e) {
    const msg = `delete ${endpoint} ids=[${ids.join(",")}]: ${String(e)}`;
    softFailLog?.push(msg);
    log(`  WARN: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Reconcile helpers — try to find entity in Direct by name pattern
// ---------------------------------------------------------------------------

interface ReconcileResult {
  signature: string;
  found: boolean;
  foundId?: number | string;
  reason?: string;
}

async function reconcileCampaign(
  signature: string,
  namePattern: string,
  account?: string
): Promise<ReconcileResult> {
  try {
    const data = await directGet(
      "/json/v5/campaigns",
      {
        method: "get",
        params: {
          SelectionCriteria: {},
          FieldNames: ["Id", "Name"],
          Page: { Limit: 1000 },
        },
      },
      account
    );
    const campaigns = ((data as Record<string, unknown>)?.result as Record<string, unknown>)
      ?.Campaigns as Array<{ Id: number; Name: string }> | undefined;
    if (!campaigns) return { signature, found: false, reason: "No Campaigns in response" };

    const match = campaigns.find((c) => c.Name === namePattern || c.Name.includes(namePattern));
    if (match) {
      return { signature, found: true, foundId: match.Id };
    }
    return { signature, found: false, reason: "not found in Direct during reconciliation" };
  } catch (e) {
    return { signature, found: false, reason: String(e) };
  }
}

async function reconcileAdGroup(
  signature: string,
  namePattern: string,
  campaignIds: number[],
  account?: string
): Promise<ReconcileResult> {
  if (campaignIds.length === 0) {
    return { signature, found: false, reason: "no campaign IDs available to scope query" };
  }
  try {
    const data = await directGet(
      "/json/v5/adgroups",
      {
        method: "get",
        params: {
          SelectionCriteria: { CampaignIds: campaignIds },
          FieldNames: ["Id", "Name", "CampaignId"],
          Page: { Limit: 1000 },
        },
      },
      account
    );
    const groups = ((data as Record<string, unknown>)?.result as Record<string, unknown>)
      ?.AdGroups as Array<{ Id: number; Name: string; CampaignId: number }> | undefined;
    if (!groups) return { signature, found: false, reason: "No AdGroups in response" };

    const match = groups.find((g) => g.Name === namePattern || g.Name.includes(namePattern));
    if (match) {
      return { signature, found: true, foundId: match.Id };
    }
    return { signature, found: false, reason: "not found in Direct during reconciliation" };
  } catch (e) {
    return { signature, found: false, reason: String(e) };
  }
}

async function reconcileAd(
  signature: string,
  namePattern: string,
  adGroupIds: number[],
  account?: string
): Promise<ReconcileResult> {
  if (adGroupIds.length === 0) {
    return { signature, found: false, reason: "no ad group IDs available to scope query" };
  }
  try {
    const data = await directGet(
      "/json/v5/ads",
      {
        method: "get",
        params: {
          SelectionCriteria: { AdGroupIds: adGroupIds },
          FieldNames: ["Id", "AdGroupId"],
          TextAd: { FieldNames: ["Title"] },
          Page: { Limit: 1000 },
        },
      },
      account
    );
    const ads = ((data as Record<string, unknown>)?.result as Record<string, unknown>)
      ?.Ads as Array<{ Id: number; AdGroupId: number; TextAd?: { Title?: string } }> | undefined;
    if (!ads) return { signature, found: false, reason: "No Ads in response" };

    const match = ads.find(
      (a) => a.TextAd?.Title === namePattern || (a.TextAd?.Title ?? "").includes(namePattern)
    );
    if (match) {
      return { signature, found: true, foundId: match.Id };
    }
    return { signature, found: false, reason: "not found in Direct during reconciliation" };
  } catch (e) {
    return { signature, found: false, reason: String(e) };
  }
}

async function reconcileImage(
  signature: string,
  namePattern: string,
  account?: string
): Promise<ReconcileResult> {
  try {
    const data = await directGet(
      "/json/v5/adimages",
      {
        method: "get",
        params: {
          FieldNames: ["AdImageHash", "Name"],
          Page: { Limit: 1000 },
        },
      },
      account
    );
    const images = ((data as Record<string, unknown>)?.result as Record<string, unknown>)
      ?.AdImages as Array<{ AdImageHash: string; Name: string }> | undefined;
    if (!images) return { signature, found: false, reason: "No AdImages in response" };

    const match = images.find((img) => img.Name === namePattern || img.Name.includes(namePattern));
    if (match) {
      return { signature, found: true, foundId: match.AdImageHash };
    }
    return { signature, found: false, reason: "not found in Direct during reconciliation" };
  } catch (e) {
    return { signature, found: false, reason: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`Starting. ledger=${LEDGER_PATH} dry-run=${DRY_RUN} account=${ACCOUNT ?? "(auto)"}`);

  // Validate account resolution early
  if (ACCOUNT) {
    try {
      // Import after env is set
      const { resolveAccount } = await import("../src/lib/account-resolver.js");
      resolveAccount("direct:api", ACCOUNT);
    } catch (e) {
      process.stderr.write(`[bundle-recovery] ERROR: account resolution failed: ${String(e)}\n`);
      process.exit(3);
    }
  }

  const ledger = await openLedger(LEDGER_PATH);

  // --------------------------------------------------------------------------
  // Phase A — Reconcile pending entries
  // --------------------------------------------------------------------------
  log("Phase A: Reconciling unresolved pending entries...");

  const unresolved = await ledger.findUnresolvedPending();
  log(`  Found ${unresolved.length} unresolved pending entries.`);

  let reconciledCount = 0;
  let reconcileFailedCount = 0;

  // Collect committed campaign/ad_group IDs for scoped queries
  const allEntries = await ledger.readAll();
  const committedCampaignIds = allEntries
    .filter((e) => e.state === "committed" && e.signature.startsWith("campaign:") && typeof e.returned_id === "number")
    .map((e) => e.returned_id as number);
  const committedAdGroupIds = allEntries
    .filter((e) => e.state === "committed" && e.signature.startsWith("ad_group:") && typeof e.returned_id === "number")
    .map((e) => e.returned_id as number);

  for (const entry of unresolved) {
    const sig = entry.signature;
    const colonIdx = sig.indexOf(":");
    if (colonIdx === -1) {
      log(`  SKIP unrecognized signature format: ${sig}`);
      await ledger.writeFailed(sig, "unrecognized signature format");
      reconcileFailedCount++;
      continue;
    }

    const opType = sig.slice(0, colonIdx);
    const namePattern = sig.slice(colonIdx + 1);

    log(`  Reconciling [${opType}] "${namePattern}"...`);

    let result: ReconcileResult;

    switch (opType) {
      case "campaign":
        result = await reconcileCampaign(sig, namePattern, ACCOUNT);
        break;
      case "ad_group":
        result = await reconcileAdGroup(sig, namePattern, committedCampaignIds, ACCOUNT);
        break;
      case "ad":
        result = await reconcileAd(sig, namePattern, committedAdGroupIds, ACCOUNT);
        break;
      case "image":
        result = await reconcileImage(sig, namePattern, ACCOUNT);
        break;
      case "keyword":
        log(`  SKIP keyword reconciliation — keywords cascade with parent ad_group delete.`);
        await ledger.writeFailed(sig, "keyword reconciliation skipped — cascades with ad_group delete");
        reconcileFailedCount++;
        continue;
      default:
        log(`  SKIP unknown op type: ${opType}`);
        await ledger.writeFailed(sig, `unknown op type: ${opType}`);
        reconcileFailedCount++;
        continue;
    }

    if (result.found && result.foundId !== undefined) {
      log(`  FOUND id=${result.foundId} for "${sig}" — writing committed.`);
      await ledger.writeCommitted(sig, result.foundId);
      reconciledCount++;
    } else {
      log(`  NOT FOUND "${sig}": ${result.reason}`);
      await ledger.writeFailed(sig, result.reason ?? "not found in Direct during reconciliation");
      reconcileFailedCount++;
    }
  }

  log(`Phase A done. Reconciled: ${reconciledCount}, failed: ${reconcileFailedCount}`);

  // --------------------------------------------------------------------------
  // Phase B — Cleanup all committed entries (reverse-dependency order)
  // --------------------------------------------------------------------------
  log("Phase B: Cleaning up committed entries...");

  const allAfterReconcile = await ledger.readAll();

  // Collect last committed state per signature
  const lastCommitted = new Map<string, LedgerEntry>();
  for (const e of allAfterReconcile) {
    if (e.state === "committed") {
      lastCommitted.set(e.signature, e);
    }
  }

  // Group by type
  const adIds: number[] = [];
  const adGroupIds: number[] = [];
  const campaignIds: number[] = [];

  for (const e of lastCommitted.values()) {
    const sig = e.signature;
    const colonIdx = sig.indexOf(":");
    const opType = colonIdx !== -1 ? sig.slice(0, colonIdx) : e.op;

    if (!e.returned_id) continue;

    switch (opType) {
      case "ad":
      case "ad_tgo":
      case "ad_rsya":
        if (typeof e.returned_id === "number") adIds.push(e.returned_id);
        break;
      case "ad_group":
        if (typeof e.returned_id === "number") adGroupIds.push(e.returned_id);
        break;
      case "campaign":
        if (typeof e.returned_id === "number") campaignIds.push(e.returned_id);
        break;
      // images: skip (account-level assets, low value, no cleanup triggered)
    }
  }

  const cleanupErrors: string[] = [];
  let cleanedCount = 0;
  const failedIds: string[] = [];

  // Deletion order: ads → ad_groups → campaigns (keywords cascade with ad_group)
  if (adIds.length > 0) {
    if (DRY_RUN) {
      for (const id of adIds) {
        log(`  [dry-run] would delete ad ${id}`);
      }
    } else {
      log(`  Deleting ${adIds.length} ad(s): [${adIds.join(", ")}]...`);
      // First archive (ads must be archived before delete)
      try {
        const archiveRes = await executeApiCall({
          apiName: "direct",
          endpoint: "/json/v5/ads",
          method: "POST",
          body: { method: "archive", params: { SelectionCriteria: { Ids: adIds } } },
          account: ACCOUNT,
        });
        if (!archiveRes.ok) {
          const msg = `archive ads [${adIds.join(",")}]: HTTP ${archiveRes.status}`;
          cleanupErrors.push(msg);
          log(`  WARN: ${msg}`);
        }
      } catch (e) {
        const msg = `archive ads [${adIds.join(",")}]: ${String(e)}`;
        cleanupErrors.push(msg);
        log(`  WARN: ${msg}`);
      }
      await directDelete("/json/v5/ads", adIds, ACCOUNT, cleanupErrors);
    }
    cleanedCount += adIds.length;
    if (DRY_RUN) adIds.forEach((id) => failedIds.push(`ad:${id} (dry-run, not executed)`));
  }

  if (adGroupIds.length > 0) {
    if (DRY_RUN) {
      for (const id of adGroupIds) {
        log(`  [dry-run] would delete ad_group ${id}`);
      }
    } else {
      log(`  Deleting ${adGroupIds.length} ad_group(s): [${adGroupIds.join(", ")}]...`);
      await directDelete("/json/v5/adgroups", adGroupIds, ACCOUNT, cleanupErrors);
    }
    cleanedCount += adGroupIds.length;
  }

  if (campaignIds.length > 0) {
    if (DRY_RUN) {
      for (const id of campaignIds) {
        log(`  [dry-run] would delete campaign ${id}`);
      }
    } else {
      log(`  Deleting ${campaignIds.length} campaign(s): [${campaignIds.join(", ")}]...`);
      await directDelete("/json/v5/campaigns", campaignIds, ACCOUNT, cleanupErrors);
    }
    cleanedCount += campaignIds.length;
  }

  // Collect IDs that failed deletion
  const failedDeletionIds: string[] = cleanupErrors.map((e) => e.split(":")[0] ?? e);

  await ledger.close();

  log(`Phase B done. Cleaned: ${cleanedCount}, delete errors: ${cleanupErrors.length}`);

  // --------------------------------------------------------------------------
  // Generate recovery report
  // --------------------------------------------------------------------------
  const now = new Date().toISOString();
  const lines: string[] = [
    `# Bundle Recovery Report`,
    ``,
    `**Generated:** ${now}`,
    `**Ledger:** ${LEDGER_PATH}`,
    `**Dry-run:** ${DRY_RUN}`,
    `**Account:** ${ACCOUNT ?? "(auto)"}`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Unresolved pending entries found | ${unresolved.length} |`,
    `| Reconciled (found in Direct) | ${reconciledCount} |`,
    `| Reconcile failed / not found | ${reconcileFailedCount} |`,
    `| Cleaned (delete attempted) | ${cleanedCount} |`,
    `| Delete errors | ${cleanupErrors.length} |`,
    ``,
  ];

  if (cleanupErrors.length > 0) {
    lines.push(`## Delete Errors`);
    lines.push(``);
    for (const err of cleanupErrors) {
      lines.push(`- ${err}`);
    }
    lines.push(``);
    lines.push(`## Manual Cleanup Needed`);
    lines.push(``);
    lines.push(`The following IDs failed deletion and require manual cleanup in Yandex Direct:`);
    lines.push(``);
    const manualIds = [
      ...adIds.map((id) => `ad:${id}`),
      ...adGroupIds.map((id) => `ad_group:${id}`),
      ...campaignIds.map((id) => `campaign:${id}`),
    ].filter((label) =>
      cleanupErrors.some((err) => err.includes(label.split(":")[1] ?? ""))
    );
    if (manualIds.length > 0) {
      for (const id of manualIds) lines.push(`- ${id}`);
    } else {
      lines.push(`(see delete errors above for details)`);
    }
    lines.push(``);
  } else if (!DRY_RUN) {
    lines.push(`All deletions succeeded. No manual cleanup needed.`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Generated by bundle-recovery.ts*`);

  fs.writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
  log(`Recovery report written to ${REPORT_PATH}`);

  if (cleanupErrors.length > 0) {
    log(`WARNING: ${cleanupErrors.length} delete error(s). See report for details.`);
  } else {
    log(DRY_RUN ? "Dry-run complete. No changes made to Yandex Direct." : "Recovery complete.");
  }
}

main().catch((e) => {
  process.stderr.write(`[bundle-recovery] FATAL: ${String(e)}\n`);
  process.exit(1);
});
