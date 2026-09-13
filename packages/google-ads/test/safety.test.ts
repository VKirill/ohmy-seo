import { afterEach, describe, expect, it } from "vitest";
import { developerToken } from "../src/lib/ads-client.js";
import { runMutation } from "../src/lib/ads-mutate.js";
import { buildFieldMetadataQueries } from "../src/tools/ads-resource-metadata.js";

afterEach(() => {
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  delete process.env.GOOGLE_ADS_ALLOW_LIVE_MUTATIONS;
});

describe("current Google Ads access model", () => {
  it("does not require the sunset developer-token header", () => {
    expect(developerToken()).toBeUndefined();
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = " legacy ";
    expect(developerToken()).toBe("legacy");
  });

  it("builds GoogleAdsFieldService queries without a FROM clause", () => {
    const queries = buildFieldMetadataQueries("campaign");
    expect(queries.attributesQuery).not.toMatch(/\bFROM\b/i);
    expect(queries.compatibleQuery).not.toMatch(/\bFROM\b/i);
  });
});

describe("mutation gate", () => {
  const mutation = {
    operation: "test_write",
    customerId: "123-456-7890",
    endpoint: "campaigns:mutate",
    operations: [{ create: { name: "Paused draft" } }],
    target: { customer_id: "1234567890" },
    change: { name: "Paused draft" },
  };

  it("returns a preview without confirm", async () => {
    const result = await runMutation(mutation);
    const payload = JSON.parse(result.content[0]!.text) as { dry_run: boolean };
    expect(payload.dry_run).toBe(true);
  });

  it("blocks every real write while the global env gate is off", async () => {
    const result = await runMutation({ ...mutation, confirm: true });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("live mutations are disabled");
  });
});
