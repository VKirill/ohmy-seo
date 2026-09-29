import { describe, expect, it } from "vitest";
import { AdId } from "../src/lib/ad-id.js";

describe("AdId", () => {
  it("accepts a 19-digit combinatorial Id as a string", () => {
    expect(AdId.parse("1914841739704982433")).toBe("1914841739704982433");
  });

  it("rejects a JSON number that already lost precision", () => {
    expect(() => AdId.parse(Number("1914841739704982433"))).toThrow();
  });
});
