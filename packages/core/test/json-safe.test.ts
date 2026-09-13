import { describe, expect, it } from "vitest";
import { parseJsonSafe, quoteUnsafeIntegers } from "../src/json-safe.js";

describe("quoteUnsafeIntegers", () => {
  it("keeps long fractions valid JSON", () => {
    const source = '{"ctr":0.018604651162790697}';
    expect(quoteUnsafeIntegers(source)).toBe(source);
    expect(parseJsonSafe(source)).toEqual({ ctr: 0.018604651162790697 });
  });

  it("quotes unsafe positive and negative integers", () => {
    expect(parseJsonSafe('{"id":1914841739704982433}')).toEqual({
      id: "1914841739704982433",
    });
    expect(parseJsonSafe('{"id":-1914841739704982433}')).toEqual({
      id: "-1914841739704982433",
    });
  });

  it("leaves safe integers, exponent values and string contents alone", () => {
    expect(parseJsonSafe('{"safe":9007199254740991}')).toEqual({
      safe: 9007199254740991,
    });
    expect(quoteUnsafeIntegers('{"value":1.25e18}')).toBe('{"value":1.25e18}');
    expect(parseJsonSafe('{"text":"1914841739704982433"}')).toEqual({
      text: "1914841739704982433",
    });
  });
});
