import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGtmCreateContainer } from "../src/tools/gtm-create-container.js";
import { runGtmDeleteContainer } from "../src/tools/gtm-delete-container.js";
import { runGtmUpdateAccount } from "../src/tools/gtm-update-account.js";
import { runGtmCreateUserPermission } from "../src/tools/gtm-create-user-permission.js";
import { runGtmUpdateUserPermission } from "../src/tools/gtm-update-user-permission.js";
import { runGtmDeleteUserPermission } from "../src/tools/gtm-delete-user-permission.js";

/**
 * Dry-run (confirm:false, the default) must never touch the network — it is
 * the only safety net a user gets before a DANGER/WRITE tool mutates or
 * deletes live GTM state. These tests stub global.fetch to throw so any
 * accidental network call fails loudly, then assert the dry-run preview
 * carries the expected resource path.
 */
function textOf(result: { content: Array<{ type: "text"; text: string }> }): string {
  return result.content[0]!.text;
}

describe("gtm admin write/danger tools — dry-run makes no network call", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("network call attempted during dry-run");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gtm_create_container: preview only, no network call", async () => {
    const result = await runGtmCreateContainer({
      accountId: "111",
      name: "My Container",
      usageContext: ["web"],
      confirm: false,
    });
    const text = textOf(result as any);
    const payload = JSON.parse(text) as Record<string, unknown>;
    expect(payload.dry_run).toBe(true);
    expect(payload.operation).toBe("create_container");
    expect((payload.target as Record<string, unknown>).accountId).toBe("111");
    expect((payload.change as Record<string, unknown>).usageContext).toEqual(["web"]);
  });

  it("gtm_delete_container: preview carries the exact DELETE path and a warning", async () => {
    const result = await runGtmDeleteContainer({
      accountId: "111",
      containerId: "222",
      confirm: false,
    });
    const payload = JSON.parse(textOf(result as any)) as Record<string, unknown>;
    expect(payload.dry_run).toBe(true);
    const target = payload.target as Record<string, unknown>;
    expect(target.path).toBe("accounts/111/containers/222");
    expect(String(payload.warning)).toMatch(/irreversible/i);
    expect(String(payload.next_step)).toContain("I-UNDERSTAND-THIS-IS-LIVE:222");
  });

  it("gtm_update_account: preview only, no read-then-write network calls", async () => {
    const result = await runGtmUpdateAccount({
      accountId: "111",
      name: "New Name",
      confirm: false,
    });
    const payload = JSON.parse(textOf(result as any)) as Record<string, unknown>;
    expect(payload.dry_run).toBe(true);
    const target = payload.target as Record<string, unknown>;
    expect(target.path).toBe("accounts/111");
    expect((payload.change as Record<string, unknown>).name).toBe("New Name");
  });

  it("gtm_create_user_permission: preview builds accountAccess.permission from accountPermission", async () => {
    const result = await runGtmCreateUserPermission({
      accountId: "111",
      emailAddress: "user@example.com",
      accountPermission: "admin",
      confirm: false,
    });
    const payload = JSON.parse(textOf(result as any)) as Record<string, unknown>;
    expect(payload.dry_run).toBe(true);
    const change = payload.change as Record<string, unknown>;
    expect(change.emailAddress).toBe("user@example.com");
    expect((change.accountAccess as Record<string, unknown>).permission).toBe("admin");
  });

  it("gtm_update_user_permission: preview carries the exact PUT path with permissionId", async () => {
    const result = await runGtmUpdateUserPermission({
      accountId: "111",
      permissionId: "333",
      accountPermission: "user",
      confirm: false,
    });
    const payload = JSON.parse(textOf(result as any)) as Record<string, unknown>;
    expect(payload.dry_run).toBe(true);
    const target = payload.target as Record<string, unknown>;
    expect(target.path).toBe("accounts/111/user_permissions/333");
    const change = payload.change as Record<string, unknown>;
    expect((change.accountAccess as Record<string, unknown>).permission).toBe("user");
  });

  it("gtm_delete_user_permission: preview carries the exact DELETE path and a warning", async () => {
    const result = await runGtmDeleteUserPermission({
      accountId: "111",
      permissionId: "333",
      confirm: false,
    });
    const payload = JSON.parse(textOf(result as any)) as Record<string, unknown>;
    expect(payload.dry_run).toBe(true);
    const target = payload.target as Record<string, unknown>;
    expect(target.path).toBe("accounts/111/user_permissions/333");
    expect(String(payload.warning)).toMatch(/revokes/i);
    expect(String(payload.next_step)).toContain("I-UNDERSTAND-THIS-IS-LIVE:333");
  });
});
