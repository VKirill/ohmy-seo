import { afterEach, describe, expect, it } from "vitest";
import { runGa4UpdateProperty } from "../src/tools/ga4-update-property.js";
import { runGa4CreateCustomDimension } from "../src/tools/ga4-create-custom-dimension.js";
import { runGa4UpdateCustomDimension } from "../src/tools/ga4-update-custom-dimension.js";
import { runGa4ArchiveCustomDimension } from "../src/tools/ga4-archive-custom-dimension.js";
import { runGa4CreateKeyEvent } from "../src/tools/ga4-create-key-event.js";
import { runGa4DeleteKeyEvent } from "../src/tools/ga4-delete-key-event.js";
import { runGa4UpdateDataRetention } from "../src/tools/ga4-update-data-retention.js";

// These tests exercise the confirm-gate dry-run branch, which returns before
// resolveAccount/executeGa4Call are ever reached. To prove that: MCP_GA4_MASTER_KEY
// is deliberately left unset. resolveAccount() -> getDb('ga4') -> resolvePackageConfig('ga4')
// throws synchronously the moment it is called, so any test below that got a clean
// dry_run:true preview instead of an error is proof no account/network path ran.
afterEach(() => {
  delete process.env.MCP_GA4_MASTER_KEY;
});

type Preview = {
  dry_run: true;
  operation: string;
  target: Record<string, unknown>;
  change: Record<string, unknown>;
  next_step: string;
};

function previewOf(result: { content: Array<{ text: string }> }): Preview {
  return JSON.parse(result.content[0]!.text) as Preview;
}

describe("ga4_update_property — dry run", () => {
  it("returns a preview with no network call and builds updateMask from provided fields only", async () => {
    const result = await runGa4UpdateProperty({
      property: "123456",
      displayName: "New Name",
      timeZone: "America/Los_Angeles",
      confirm: false,
    });
    const preview = previewOf(result as any);
    expect(preview.dry_run).toBe(true);
    expect(preview.operation).toBe("PATCH property");
    expect(preview.target).toEqual({ property: "properties/123456", path: "v1beta/properties/123456" });
    expect(preview.change).toEqual({ displayName: "New Name", timeZone: "America/Los_Angeles" });
  });

  it("accepts an already-qualified 'properties/NNN' id unchanged", async () => {
    const result = await runGa4UpdateProperty({
      property: "properties/999",
      currencyCode: "USD",
      confirm: false,
    });
    const preview = previewOf(result as any);
    expect(preview.target.property).toBe("properties/999");
  });

  it("rejects an update with no fields before any account/network work", async () => {
    const result = (await runGa4UpdateProperty({ property: "123", confirm: false })) as {
      isError: true;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("At least one field");
  });

  it("confirm:true attempts real execution and fails deterministically without MCP_GA4_MASTER_KEY (proves dry-run above never reached this path)", async () => {
    const result = (await runGa4UpdateProperty({
      property: "123",
      displayName: "x",
      confirm: true,
    })) as { isError: true; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/MASTER_KEY|Unexpected error/);
  });
});

describe("ga4_create_custom_dimension — dry run", () => {
  it("builds the create path and body", async () => {
    const result = await runGa4CreateCustomDimension({
      property: "123",
      parameterName: "plan_tier",
      displayName: "Plan Tier",
      scope: "EVENT",
      confirm: false,
    });
    const preview = previewOf(result as any);
    expect(preview.operation).toBe("POST customDimension");
    expect(preview.target).toEqual({
      property: "properties/123",
      path: "v1beta/properties/123/customDimensions",
    });
    expect(preview.change).toEqual({
      parameterName: "plan_tier",
      displayName: "Plan Tier",
      scope: "EVENT",
    });
  });

  it("rejects disallowAdsPersonalization on a non-USER scope", async () => {
    const result = (await runGa4CreateCustomDimension({
      property: "123",
      parameterName: "plan_tier",
      displayName: "Plan Tier",
      scope: "EVENT",
      disallowAdsPersonalization: true,
      confirm: false,
    })) as { isError: true; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("USER");
  });

  it("allows disallowAdsPersonalization on USER scope", async () => {
    const result = await runGa4CreateCustomDimension({
      property: "123",
      parameterName: "user_plan",
      displayName: "User Plan",
      scope: "USER",
      disallowAdsPersonalization: true,
      confirm: false,
    });
    const preview = previewOf(result as any);
    expect(preview.change).toMatchObject({ disallowAdsPersonalization: true });
  });
});

describe("ga4_update_custom_dimension — dry run", () => {
  it("normalizes a bare numeric id into a full resource name", async () => {
    const result = await runGa4UpdateCustomDimension({
      property: "123",
      customDimension: "456",
      displayName: "Renamed",
      confirm: false,
    });
    const preview = previewOf(result as any);
    expect(preview.target.name).toBe("properties/123/customDimensions/456");
    expect(preview.target.path).toBe("v1beta/properties/123/customDimensions/456");
  });

  it("passes through an already-qualified custom dimension name", async () => {
    const result = await runGa4UpdateCustomDimension({
      property: "123",
      customDimension: "properties/123/customDimensions/456",
      description: "d",
      confirm: false,
    });
    const preview = previewOf(result as any);
    expect(preview.target.name).toBe("properties/123/customDimensions/456");
  });

  it("rejects an update with no fields", async () => {
    const result = (await runGa4UpdateCustomDimension({
      property: "123",
      customDimension: "456",
      confirm: false,
    })) as { isError: true; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
  });
});

describe("ga4_archive_custom_dimension — dry run (irreversible)", () => {
  it("builds the :archive path and warns", async () => {
    const result = await runGa4ArchiveCustomDimension({
      property: "123",
      customDimension: "456",
      confirm: false,
    });
    const preview = previewOf(result as any);
    expect(preview.operation).toBe("POST customDimension:archive");
    expect(preview.target.path).toBe("v1beta/properties/123/customDimensions/456:archive");
    expect(JSON.stringify(preview.change)).toMatch(/irreversible/i);
  });
});

describe("ga4_create_key_event — dry run", () => {
  it("builds the create path and body", async () => {
    const result = await runGa4CreateKeyEvent({
      property: "123",
      eventName: "purchase",
      countingMethod: "ONCE_PER_EVENT",
      confirm: false,
    });
    const preview = previewOf(result as any);
    expect(preview.target.path).toBe("v1beta/properties/123/keyEvents");
    expect(preview.change).toEqual({ eventName: "purchase", countingMethod: "ONCE_PER_EVENT" });
  });
});

describe("ga4_delete_key_event — dry run (irreversible)", () => {
  it("normalizes the key event name and warns", async () => {
    const result = await runGa4DeleteKeyEvent({
      property: "123",
      keyEvent: "789",
      confirm: false,
    });
    const preview = previewOf(result as any);
    expect(preview.target.name).toBe("properties/123/keyEvents/789");
    expect(JSON.stringify(preview.change)).toMatch(/irreversible/i);
  });
});

describe("ga4_update_data_retention — dry run", () => {
  it("builds updateMask from every provided field", async () => {
    const result = await runGa4UpdateDataRetention({
      property: "123",
      eventDataRetention: "FOURTEEN_MONTHS",
      resetUserDataOnNewActivity: true,
      confirm: false,
    });
    const preview = previewOf(result as any);
    expect(preview.target.path).toBe("v1beta/properties/123/dataRetentionSettings");
    expect(preview.change).toEqual({
      eventDataRetention: "FOURTEEN_MONTHS",
      resetUserDataOnNewActivity: true,
    });
  });

  it("rejects an update with no fields", async () => {
    const result = (await runGa4UpdateDataRetention({
      property: "123",
      confirm: false,
    })) as { isError: true; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
  });
});

describe("toUpdateMask", () => {
  it("converts field names to the snake_case paths the Admin API requires", async () => {
    const { toUpdateMask } = await import("../src/lib/ga4-resource-names.js");
    expect(toUpdateMask(["eventDataRetention", "resetUserDataOnNewActivity", "displayName"]))
      .toBe("event_data_retention,reset_user_data_on_new_activity,display_name");
  });
});
