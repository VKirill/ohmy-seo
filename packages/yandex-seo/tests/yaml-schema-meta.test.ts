import { describe, it, expect } from "vitest";
import { GroupSchema } from "../src/lib/yaml-schema.js";

const BASE_GROUP = {
  group: {
    Name: "cl01_test",
    Type: "TEXT_AD_GROUP" as const,
    RegionIds: [213],
  },
  keywords: [{ Keyword: "тест" }],
  ads: [
    {
      Type: "TEXT_AD" as const,
      TextAd: {
        Title: "Заголовок",
        Text: "Текст",
        Href: "https://example.com",
      },
    },
  ],
};

describe("GroupSchema — _meta.marker_query and combinatorial", () => {
  it("accepts a group with _meta.marker_query", () => {
    const result = GroupSchema.safeParse({
      ...BASE_GROUP,
      _meta: { cluster_id: "cl01", marker_query: "маркерный запрос" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a group without _meta.marker_query (optional)", () => {
    const result = GroupSchema.safeParse({
      ...BASE_GROUP,
      _meta: { cluster_id: "cl01" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid combinatorial with headlines<=7 and texts<=3", () => {
    const result = GroupSchema.safeParse({
      ...BASE_GROUP,
      combinatorial: {
        headlines: ["H1", "H2", "H3"],
        texts: ["T1", "T2"],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects combinatorial with >7 headlines", () => {
    const result = GroupSchema.safeParse({
      ...BASE_GROUP,
      combinatorial: {
        headlines: ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8"],
        texts: ["T1"],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects combinatorial with >3 texts", () => {
    const result = GroupSchema.safeParse({
      ...BASE_GROUP,
      combinatorial: {
        headlines: ["H1"],
        texts: ["T1", "T2", "T3", "T4"],
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a group without combinatorial (optional)", () => {
    const result = GroupSchema.safeParse(BASE_GROUP);
    expect(result.success).toBe(true);
  });
});
