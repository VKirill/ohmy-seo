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

export class AcknowledgeLiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcknowledgeLiveError";
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

/**
 * Asserts that the caller has supplied the exact acknowledge_live token for
 * the given requiredTargetId.  The required format is:
 *   I-UNDERSTAND-THIS-IS-LIVE:<requiredTargetId>
 *
 * The target-ID echo prevents copy-paste cargo-culting across contexts.
 */
export function assertAcknowledgeLive(
  args: { acknowledge_live?: string },
  requiredTargetId: string
): void {
  const expected = `I-UNDERSTAND-THIS-IS-LIVE:${requiredTargetId}`;

  if (!args.acknowledge_live) {
    throw new AcknowledgeLiveError(
      `acknowledge_live required. Pass: '${expected}' to confirm operation on this specific target.`
    );
  }

  if (args.acknowledge_live.trim() !== expected) {
    throw new AcknowledgeLiveError(
      `acknowledge_live mismatch. Got "${args.acknowledge_live}", expected "${expected}".`
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
// Reusable Zod schema fragments
// ---------------------------------------------------------------------------

export const confirmField = z
  .boolean()
  .default(false)
  .describe("Set to true to execute. False returns dry-run preview.");

export const acknowledgeLiveField = z
  .string()
  .optional()
  .describe(
    "Required for DANGER tools. Format: I-UNDERSTAND-THIS-IS-LIVE:<target_id>"
  );
