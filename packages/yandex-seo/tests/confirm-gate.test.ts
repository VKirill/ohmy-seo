/**
 * Tests for confirm-gate.ts, including the W3.4 mutation-budget-gate:
 *   - Without options.budgetCheck, behavior is byte-for-byte unchanged from
 *     before the threshold feature existed.
 *   - With options.budgetCheck but no ceiling env var configured (or <= 0 /
 *     non-numeric), the threshold step is a complete no-op — opt-in only.
 *   - With a ceiling configured and the proposed amount at/under it, no extra
 *     ack is required.
 *   - With a ceiling configured and the amount over it, a correct
 *     acknowledge_budget_threshold is required (missing or wrong -> throws
 *     BUDGET_THRESHOLD_ACK_MISMATCH); the exact expected string round-trips
 *     through requiredBudgetThresholdAck().
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  requireConfirmGate,
  requiredBudgetThresholdAck,
  validateLiveAck,
  ConfirmGateError,
} from "../src/lib/api/confirm-gate.js";

const CEILING_ENV = "YANDEX_DIRECT_MAX_DAILY_BUDGET_MICROS";
const BASE_ACK = "I-UNDERSTAND-BUDGET-LIVE:default:1,2:5000000";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    confirm: true,
    acknowledge_live: BASE_ACK,
    ...overrides,
  };
}

describe("requireConfirmGate — mutation-budget-gate (W3.4)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.OHMY_SEO_ALLOW_LIVE_MUTATIONS = process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS;
    savedEnv.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS = process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS;
    savedEnv[CEILING_ENV] = process.env[CEILING_ENV];
    process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS = "true";
    process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS = "true";
    delete process.env[CEILING_ENV];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("no budgetCheck option -> behavior unchanged (base ack alone is sufficient)", () => {
    expect(() => requireConfirmGate(baseInput(), { expectedAck: BASE_ACK })).not.toThrow();
  });

  it("budgetCheck present but ceiling env var unset -> no-op, base ack alone is sufficient", () => {
    expect(() =>
      requireConfirmGate(baseInput(), {
        expectedAck: BASE_ACK,
        budgetCheck: { amountMicros: 5_000_000, ceilingEnvVar: CEILING_ENV, label: "BUDGET" },
      })
    ).not.toThrow();
  });

  it("ceiling configured but non-numeric -> treated as unset, no-op", () => {
    process.env[CEILING_ENV] = "not-a-number";
    expect(() =>
      requireConfirmGate(baseInput(), {
        expectedAck: BASE_ACK,
        budgetCheck: { amountMicros: 5_000_000, ceilingEnvVar: CEILING_ENV, label: "BUDGET" },
      })
    ).not.toThrow();
  });

  it("ceiling configured but <= 0 -> treated as unset, no-op", () => {
    process.env[CEILING_ENV] = "0";
    expect(() =>
      requireConfirmGate(baseInput(), {
        expectedAck: BASE_ACK,
        budgetCheck: { amountMicros: 5_000_000, ceilingEnvVar: CEILING_ENV, label: "BUDGET" },
      })
    ).not.toThrow();
  });

  it("amount at the ceiling (not over) -> no extra ack required", () => {
    process.env[CEILING_ENV] = "5000000";
    expect(() =>
      requireConfirmGate(baseInput(), {
        expectedAck: BASE_ACK,
        budgetCheck: { amountMicros: 5_000_000, ceilingEnvVar: CEILING_ENV, label: "BUDGET" },
      })
    ).not.toThrow();
  });

  it("amount over ceiling, no acknowledge_budget_threshold -> throws BUDGET_THRESHOLD_ACK_MISMATCH", () => {
    process.env[CEILING_ENV] = "1000000";
    expect(() =>
      requireConfirmGate(baseInput(), {
        expectedAck: BASE_ACK,
        budgetCheck: { amountMicros: 5_000_000, ceilingEnvVar: CEILING_ENV, label: "BUDGET" },
      })
    ).toThrowError(ConfirmGateError);
    try {
      requireConfirmGate(baseInput(), {
        expectedAck: BASE_ACK,
        budgetCheck: { amountMicros: 5_000_000, ceilingEnvVar: CEILING_ENV, label: "BUDGET" },
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfirmGateError);
      expect((err as ConfirmGateError).code).toBe("BUDGET_THRESHOLD_ACK_MISMATCH");
    }
  });

  it("amount over ceiling, wrong acknowledge_budget_threshold -> throws", () => {
    process.env[CEILING_ENV] = "1000000";
    expect(() =>
      requireConfirmGate(
        baseInput({ acknowledge_budget_threshold: "I-UNDERSTAND-BUDGET-EXCEEDS-THRESHOLD:wrong:wrong" }),
        {
          expectedAck: BASE_ACK,
          budgetCheck: { amountMicros: 5_000_000, ceilingEnvVar: CEILING_ENV, label: "BUDGET" },
        }
      )
    ).toThrowError(ConfirmGateError);
  });

  it("amount over ceiling, correct acknowledge_budget_threshold -> passes", () => {
    process.env[CEILING_ENV] = "1000000";
    const expected = requiredBudgetThresholdAck(5_000_000, 1_000_000, "BUDGET");
    expect(expected).toBe("I-UNDERSTAND-BUDGET-EXCEEDS-THRESHOLD:5000000:1000000");
    expect(() =>
      requireConfirmGate(baseInput({ acknowledge_budget_threshold: expected }), {
        expectedAck: BASE_ACK,
        budgetCheck: { amountMicros: 5_000_000, ceilingEnvVar: CEILING_ENV, label: "BUDGET" },
      })
    ).not.toThrow();
  });

  it("base ack still enforced even when budget threshold would pass", () => {
    process.env[CEILING_ENV] = "1000000";
    const expected = requiredBudgetThresholdAck(5_000_000, 1_000_000, "BUDGET");
    expect(() =>
      requireConfirmGate(
        baseInput({ acknowledge_live: "wrong-ack", acknowledge_budget_threshold: expected }),
        {
          expectedAck: BASE_ACK,
          budgetCheck: { amountMicros: 5_000_000, ceilingEnvVar: CEILING_ENV, label: "BUDGET" },
        }
      )
    ).toThrowError(ConfirmGateError);
  });
});

describe("validateLiveAck (pre-existing, unaffected by this change)", () => {
  it("matches the exact expected format", () => {
    expect(validateLiveAck("I-UNDERSTAND-BUNDLE-LIVE:acme:abcdef123456", "acme", "abcdef123456789")).toBe(true);
  });

  it("rejects any deviation", () => {
    expect(validateLiveAck("wrong", "acme", "abcdef123456789")).toBe(false);
    expect(validateLiveAck(undefined, "acme", "abcdef123456789")).toBe(false);
  });
});
