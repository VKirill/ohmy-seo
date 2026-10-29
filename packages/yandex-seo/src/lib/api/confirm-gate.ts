export interface ConfirmGateInput {
  confirm?: boolean;
  acknowledge_live?: string;
  acknowledge_budget_threshold?: string;
}

export interface BudgetThresholdCheck {
  /** Proposed amount, in the same micros unit used throughout ohmy-seo (amount × 1_000_000). */
  amountMicros: number;
  /**
   * Env var naming the ceiling, same micros unit. Unset or unparseable (including
   * <= 0) means no ceiling is configured, so this check is a complete no-op —
   * opt-in only, deployments that never set it see zero behavior change.
   */
  ceilingEnvVar: string;
  /** Label folded into the required extra-ack string, e.g. "BUDGET" or "WEEKLY_BUDGET". */
  label: string;
}

export interface ConfirmGateOptions {
  expectedAck: string;
  extraEnvFlag?: string;
  budgetCheck?: BudgetThresholdCheck;
}

export class ConfirmGateError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ConfirmGateError";
  }
}

/**
 * Validate that `ack` is EXACTLY the expected live-ack string for the given login and plan_hash.
 * Expected format: `I-UNDERSTAND-BUNDLE-LIVE:<login>:<planHash.slice(0,12)>`
 * Performs exact string equality — any deviation (wrong login, extra segment, wrong hash) returns false.
 */
export function validateLiveAck(ack: string | undefined, login: string, planHash: string): boolean {
  if (!ack || !login || !planHash) return false;
  const expected = `I-UNDERSTAND-BUNDLE-LIVE:${login}:${planHash.slice(0, 12)}`;
  return ack === expected;
}

/**
 * Build the exact `acknowledge_budget_threshold` string a caller must echo back
 * when a proposed amount exceeds a configured ceiling. Exported so tools/tests
 * can construct the expected value without duplicating the format string.
 */
export function requiredBudgetThresholdAck(amountMicros: number, ceilingMicros: number, label: string): string {
  return `I-UNDERSTAND-${label}-EXCEEDS-THRESHOLD:${amountMicros}:${ceilingMicros}`;
}

/**
 * Read a positive numeric ceiling from an env var. Returns undefined for unset,
 * non-numeric, zero, or negative values — all of which mean "no ceiling configured".
 */
function readCeilingMicros(envVar: string): number | undefined {
  const raw = process.env[envVar];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function requireConfirmGate(
  input: ConfirmGateInput,
  options: ConfirmGateOptions
): void {
  // 1. Check global env flag
  if (process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS !== "true") {
    throw new ConfirmGateError(
      "MISSING_GLOBAL_FLAG",
      "Global mutation flag missing. Set OHMY_SEO_ALLOW_LIVE_MUTATIONS=true to enable any platform mutations across ohmy-seo."
    );
  }
  // 2. Check platform-specific env flag
  if (process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS !== "true") {
    throw new ConfirmGateError(
      "MISSING_PLATFORM_FLAG",
      "Yandex Direct mutation flag missing. Set YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true to enable Yandex Direct write operations. (Platform-isolated: does not read flags for other platforms.)"
    );
  }
  // 3. Optional extra flag (e.g. YANDEX_DIRECT_ALLOW_DELETE)
  if (options.extraEnvFlag && process.env[options.extraEnvFlag] !== "true") {
    throw new ConfirmGateError(
      "MISSING_EXTRA_FLAG",
      `Extra mutation flag missing: ${options.extraEnvFlag}=true required for this operation.`
    );
  }
  // 4. Confirm boolean
  if (input.confirm !== true) {
    throw new ConfirmGateError(
      "MISSING_CONFIRM",
      "confirm: true is required for this operation."
    );
  }
  // 5. acknowledge_live exact match
  if (input.acknowledge_live !== options.expectedAck) {
    throw new ConfirmGateError(
      "ACK_MISMATCH",
      `acknowledge_live mismatch. Expected exactly: "${options.expectedAck}". Got: ${JSON.stringify(input.acknowledge_live)}.`
    );
  }
  // 6. Mutation-budget-gate: an amount above a configured ceiling requires a
  //    SECOND, distinct typed acknowledgment on top of the live-mutation ack
  //    from step 5 — catches a fat-fingered or hallucinated budget before it
  //    reaches a live campaign. No ceiling configured (env var unset/<=0) means
  //    this step never fires — opt-in, zero behavior change until set.
  if (options.budgetCheck) {
    const { amountMicros, ceilingEnvVar, label } = options.budgetCheck;
    const ceilingMicros = readCeilingMicros(ceilingEnvVar);
    if (ceilingMicros !== undefined && amountMicros > ceilingMicros) {
      const expectedBudgetAck = requiredBudgetThresholdAck(amountMicros, ceilingMicros, label);
      if (input.acknowledge_budget_threshold !== expectedBudgetAck) {
        throw new ConfirmGateError(
          "BUDGET_THRESHOLD_ACK_MISMATCH",
          `Proposed amount ${amountMicros} exceeds the configured ceiling ${ceilingEnvVar}=${ceilingMicros}. ` +
            `Pass acknowledge_budget_threshold exactly: "${expectedBudgetAck}".`
        );
      }
    }
  }
}
