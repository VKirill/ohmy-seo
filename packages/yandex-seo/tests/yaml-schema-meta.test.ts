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

describe("GroupSchema — per-group sitelinks_set and callouts overrides", () => {
  const EIGHT_SITELINKS = Array.from({ length: 8 }, (_, i) => ({
    Title: `Ссылка ${i + 1}`,
    Description: `Описание ссылки ${i + 1}`,
    Href: `https://example.com/link-${i + 1}`,
  }));

  it("accepts a group with sitelinks_set (8 links with descriptions) and callouts", () => {
    const result = GroupSchema.safeParse({
      ...BASE_GROUP,
      sitelinks_set: { Sitelinks: EIGHT_SITELINKS },
      callouts: ["Гарантия 2 года", "Доставка по РФ", "Скидка 20%", "Опыт 10 лет"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sitelinks_set?.Sitelinks).toHaveLength(8);
      expect(result.data.callouts).toHaveLength(4);
    }
  });

  it("accepts a group without sitelinks_set/callouts (both optional)", () => {
    const result = GroupSchema.safeParse(BASE_GROUP);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sitelinks_set).toBeUndefined();
      expect(result.data.callouts).toBeUndefined();
    }
  });

  it("rejects group sitelinks_set with more than 8 links", () => {
    const nine = [...EIGHT_SITELINKS, { Title: "Девятая", Href: "https://example.com/9" }];
    const result = GroupSchema.safeParse({
      ...BASE_GROUP,
      sitelinks_set: { Sitelinks: nine },
    });
    expect(result.success).toBe(false);
  });

  it("rejects group sitelink Title longer than 30 chars", () => {
    const result = GroupSchema.safeParse({
      ...BASE_GROUP,
      sitelinks_set: {
        Sitelinks: [{ Title: "Очень длинный заголовок быстрой ссылки", Href: "https://example.com" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects group sitelink Description longer than 60 chars", () => {
    const result = GroupSchema.safeParse({
      ...BASE_GROUP,
      sitelinks_set: {
        Sitelinks: [{
          Title: "Ссылка",
          Description: "О".repeat(61),
          Href: "https://example.com",
        }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects group callout longer than 25 chars", () => {
    const result = GroupSchema.safeParse({
      ...BASE_GROUP,
      callouts: ["Это уточнение длиннее 25 символов"],
    });
    expect(result.success).toBe(false);
  });
});
