import { describe, expect, it } from "vitest";
import { normalizeBody } from "../src/lib/api-gateway.js";
import { parseReportTsv } from "../src/lib/api/reports-polling.js";

describe("normalizeBody", () => {
  it("parses JSON object and array strings supplied by MCP clients", () => {
    expect(normalizeBody(' {"method":"get","params":{}} ')).toEqual({
      method: "get",
      params: {},
    });
    expect(normalizeBody('[1,2]')).toEqual([1, 2]);
  });

  it("preserves ordinary and malformed strings", () => {
    expect(normalizeBody("plain text")).toBe("plain text");
    expect(normalizeBody("{not json}")).toBe("{not json}");
  });
});

describe("parseReportTsv", () => {
  it("skips a title line and handles CRLF", () => {
    const tsv = '"Campaign report (2026-09-01 - 2026-09-12)"\r\nCampaignId\tClicks\r\n123\t7\r\n';
    expect(parseReportTsv(tsv)).toEqual([{ CampaignId: "123", Clicks: "7" }]);
  });

  it("returns no rows when only a title or header is present", () => {
    expect(parseReportTsv('"Empty report"\nCampaignId\tClicks\n')).toEqual([]);
  });
});
