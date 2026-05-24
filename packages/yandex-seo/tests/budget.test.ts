import { describe, it, expect, vi } from "vitest";

// Mock transitive dependencies that import @ohmy-seo/mcp-core subpaths
// (those subpath exports are unavailable in the test environment — known pre-existing issue)
vi.mock("../src/lib/api-gateway.js", () => ({}));
vi.mock("../src/lib/account-resolver.js", () => ({}));
vi.mock("../src/lib/csv-parser.js", () => ({}));
vi.mock("../src/lib/bundle-ledger.js", () => ({}));
vi.mock("../src/lib/payload-builder.js", () => ({}));

import { resolveDailyBudgetMicros } from "../src/lib/upload-pipeline.js";

describe("resolveDailyBudgetMicros", () => {
  it("EUR budget passes through correctly: 8_500_000 micros stays 8_500_000 (not 8)", () => {
    const micros = resolveDailyBudgetMicros({ daily_budget_amount: 8_500_000 });
    expect(micros).toBe(8_500_000);
    // Verify the old Math.floor(/1_000_000) approach would have lost precision
    expect(micros).not.toBe(8);
  });

  it("deprecated daily_budget_rub still multiplies by 1_000_000: rub=100 → 100_000_000 micros", () => {
    const micros = resolveDailyBudgetMicros({ daily_budget_rub: 100 });
    expect(micros).toBe(100_000_000);
  });

  it("daily_budget_amount takes priority over daily_budget_rub when both present", () => {
    const micros = resolveDailyBudgetMicros({
      daily_budget_amount: 8_500_000,
      daily_budget_rub: 100,
    });
    expect(micros).toBe(8_500_000);
  });

  it("defaults to 0 micros when neither field is provided", () => {
    const micros = resolveDailyBudgetMicros({});
    expect(micros).toBe(0);
  });
});
