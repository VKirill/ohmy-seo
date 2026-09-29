import { describe, expect, it } from "vitest";
import { parseJsonSafe } from "../apps/gateway/src/json-safe";

describe("hosted MCP JSON parse", () => {
  it("keeps a 19-digit Direct ad Id that express.json would round", () => {
    const raw = '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"yandex_direct_update_ad","arguments":{"ad_id":1914841739704982433}}}';
    const rounded = JSON.parse(raw).params.arguments.ad_id;
    expect(typeof rounded).toBe("number");
    expect(String(rounded)).not.toBe("1914841739704982433");
    expect(parseJsonSafe(raw)).toEqual({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "yandex_direct_update_ad",
        arguments: { ad_id: "1914841739704982433" },
      },
    });
  });
});
