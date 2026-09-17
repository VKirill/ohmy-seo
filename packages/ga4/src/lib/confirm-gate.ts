/**
 * Confirm gate for GA4 Admin API write tools.
 *
 * Ported from packages/gtm/src/lib/confirm-gate.ts (trimmed to what ga4 needs —
 * no acknowledge_live step, since none of the ga4 write tools affect a live
 * published surface the way gtm_publish_version/gtm_rollback do; irreversible
 * ops like archive/delete use the plain confirm gate, mirroring gtm_delete_tag).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class ConfirmRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmRequiredError";
  }
}

// ---------------------------------------------------------------------------
// Guard functions
// ---------------------------------------------------------------------------

/**
 * Asserts that the caller has explicitly set confirm:true.
 * Throw ConfirmRequiredError otherwise (dry-run callers catch this and return preview).
 */
export function assertConfirm(args: { confirm?: boolean }): void {
  if (args.confirm !== true) {
    throw new ConfirmRequiredError(
      "Confirm required: pass confirm:true to execute write."
    );
  }
}

// ---------------------------------------------------------------------------
// Dry-run preview helper
// ---------------------------------------------------------------------------

export interface DryRunPreview {
  dry_run: true;
  operation: string;
  target: object;
  change: object;
  next_step: string;
}

export function buildDryRunPreview(
  operation: string,
  target: object,
  change: object
): DryRunPreview {
  return {
    dry_run: true,
    operation,
    target,
    change,
    next_step: "Re-run with confirm:true to execute.",
  };
}

// ---------------------------------------------------------------------------
// Reusable Zod schema fragment
// ---------------------------------------------------------------------------

export const confirmField = z
  .boolean()
  .default(false)
  .describe("Set to true to execute. False returns dry-run preview.");
