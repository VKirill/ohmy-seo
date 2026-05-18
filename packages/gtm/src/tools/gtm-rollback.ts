import crypto from "node:crypto";
import { SCOPE_GTM_PUBLISH } from "@ohmy-seo/mcp-core/google-oauth";
import { getDb } from "@ohmy-seo/mcp-core/db";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";
import { assertAcknowledgeLive } from "../lib/confirm-gate.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_rollback";
const ROLLBACK_TTL_MS = 300_000; // 5 minutes

export const schema = {
  name: TOOL_NAME,
  description:
    "DANGER — two-step DB-backed rollback. " +
    "Step 1 (confirm:false): previews rollback from live → target version, stores a plan (5 min TTL), returns plan_id. " +
    "Step 2 (confirm:true + plan_id + acknowledge_live): atomically claims plan, re-checks fingerprint, publishes target version. " +
    "acknowledge_live format: I-UNDERSTAND-THIS-IS-LIVE:<containerId>.",
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: "object" as const,
    properties: {
      account: { type: "string", description: "Label of a registered Google account (optional)." },
      accountId: { type: "string", description: "GTM Account ID." },
      containerId: { type: "string", description: "GTM Container ID." },
      workspaceId: { type: "string", description: "GTM Workspace ID." },
      to_version_id: { type: "string", description: "Target version to roll back to." },
      plan_id: { type: "string", description: "Required for confirm step. UUID from step 1." },
      confirm: { type: "boolean", description: "False (default) = preview. True = execute.", default: false },
      acknowledge_live: { type: "string", description: "Required when confirm:true. Format: I-UNDERSTAND-THIS-IS-LIVE:<containerId>" },
    },
    required: ["accountId", "containerId", "workspaceId", "to_version_id"],
  },
};

export async function runGtmRollback(args: {
  account?: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
  to_version_id: string;
  plan_id?: string;
  confirm?: boolean;
  acknowledge_live?: string;
}) {
  // resolveAccount checks tagmanager.publish scope before any API call
  const account = await resolveAccount(PKG_NAME, SCOPE_GTM_PUBLISH, args.account);

  // --- STEP 1: Preview / create plan ---
  if (!args.confirm) {
    const liveRes = await executeGtmCall({
      account, scope: SCOPE_GTM_PUBLISH, method: "GET",
      path: `accounts/${args.accountId}/containers/${args.containerId}/versions:live`,
    });
    const liveData = liveRes.data as Record<string, unknown>;
    const liveVersion = (liveData["containerVersion"] ?? liveData) as Record<string, unknown>;
    const fromVersionId = String(liveVersion["containerVersionId"] ?? liveVersion["versionId"] ?? "");
    const fingerprint = String(
      liveVersion["fingerprint"] ?? liveVersion["tagManagerUrl"] ??
      `${args.containerId}:${fromVersionId}:${Date.now()}`
    );

    const targetRes = await executeGtmCall({
      account, scope: SCOPE_GTM_PUBLISH, method: "GET",
      path: `accounts/${args.accountId}/containers/${args.containerId}/versions/${args.to_version_id}`,
    });
    if (!targetRes.ok) {
      throw new Error(`Target version ${args.to_version_id} not found: HTTP ${targetRes.status}`);
    }

    const planId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + ROLLBACK_TTL_MS;
    const expiresAtSec = Math.floor(expiresAt / 1000);

    getDb(PKG_NAME).prepare(`
      INSERT INTO gtm_rollback_plans
        (id, account_id, gtm_account_id, container_id, workspace_id,
         from_version_id, to_version_id, fingerprint, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      planId, account.id, args.accountId, args.containerId, args.workspaceId,
      fromVersionId, args.to_version_id, fingerprint, expiresAtSec, Math.floor(now / 1000)
    );

    return {
      dry_run: true,
      plan_id: planId,
      expires_at: new Date(expiresAt).toISOString(),
      preview: {
        from_version: fromVersionId,
        to_version: args.to_version_id,
        fingerprint_at_preview: fingerprint,
        warning: `Rollback will publish version ${args.to_version_id} as new live.`,
      },
      next_step: `Within 5 min, call ${TOOL_NAME} with the SAME args + plan_id:'${planId}' + confirm:true + acknowledge_live:'I-UNDERSTAND-THIS-IS-LIVE:${args.containerId}'`,
    };
  }

  // --- STEP 2: Execute rollback ---
  assertAcknowledgeLive(args, args.containerId);

  if (!args.plan_id) {
    throw new Error("plan_id is required for confirm step. Re-run preview to get one.");
  }

  // Atomic claim: DELETE...RETURNING (SQLite 3.35+, better-sqlite3 ships newer)
  const nowSec = Math.floor(Date.now() / 1000);
  const plans = getDb(PKG_NAME).prepare(`
    DELETE FROM gtm_rollback_plans
    WHERE id = ? AND expires_at > ?
    RETURNING *
  `).all(args.plan_id, nowSec) as Array<Record<string, unknown>>;

  if (plans.length === 0) {
    throw new Error("Plan expired or not found. Re-run preview to get a fresh plan.");
  }

  const plan = plans[0];

  // Verify args match the stored plan
  if (plan["container_id"] !== args.containerId || plan["workspace_id"] !== args.workspaceId ||
      plan["to_version_id"] !== args.to_version_id || plan["gtm_account_id"] !== args.accountId) {
    throw new Error("Plan args mismatch. containerId, workspaceId, to_version_id, accountId must match preview.");
  }

  // Re-fetch live state and compare fingerprint (detect concurrent edits)
  const liveRes = await executeGtmCall({
    account, scope: SCOPE_GTM_PUBLISH, method: "GET",
    path: `accounts/${args.accountId}/containers/${args.containerId}/versions:live`,
  });
  const liveData = liveRes.data as Record<string, unknown>;
  const liveVersion = (liveData["containerVersion"] ?? liveData) as Record<string, unknown>;
  const currentFingerprint = String(liveVersion["fingerprint"] ?? liveVersion["tagManagerUrl"] ?? "");

  if (currentFingerprint !== String(plan["fingerprint"])) {
    throw Object.assign(
      new Error("Concurrent edit detected (fingerprint changed). Re-run preview to get a fresh plan."),
      { status: 409 }
    );
  }

  // Execute: create_version_from_old → publish new version
  const createRes = await executeGtmCall({
    account, scope: SCOPE_GTM_PUBLISH, method: "POST",
    path: `accounts/${args.accountId}/containers/${args.containerId}/versions/${args.to_version_id}:create_version_from_old`,
  });
  if (!createRes.ok) throw new Error(`create_version_from_old failed: HTTP ${createRes.status}`);

  const createData = createRes.data as Record<string, unknown>;
  const newVersionData = (createData["containerVersion"] ?? createData) as Record<string, unknown>;
  const newVersionId = String(newVersionData["containerVersionId"] ?? newVersionData["versionId"] ?? "");

  const publishRes = await executeGtmCall({
    account, scope: SCOPE_GTM_PUBLISH, method: "POST",
    path: `accounts/${args.accountId}/containers/${args.containerId}/versions/${newVersionId}:publish`,
  });
  if (!publishRes.ok) throw new Error(`publish failed for new version ${newVersionId}: HTTP ${publishRes.status}`);

  return {
    success: true,
    new_version_id: newVersionId,
    previous_live_version_id: String(plan["from_version_id"]),
    rolled_back_to: args.to_version_id,
  };
}
