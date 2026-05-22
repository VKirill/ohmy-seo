import { describe, it, expect, vi } from "vitest";

// Mock transitive dependencies that import @ohmy-seo/mcp-core subpaths
// (those subpath exports are unavailable in the test environment — known pre-existing issue)
vi.mock("../src/lib/api-gateway.js", () => ({}));
vi.mock("../src/lib/account-resolver.js", () => ({}));
vi.mock("../src/lib/csv-parser.js", () => ({}));
vi.mock("../src/lib/bundle-ledger.js", () => ({}));
vi.mock("../src/lib/payload-builder.js", () => ({}));

import { pickAdTemplate } from "../src/lib/upload-pipeline.js";

describe("pickAdTemplate", () => {
  it("returns real template when agent-provided + cluster_id_pattern matches", () => {
    const templates = [
      {
        variant_label: "v1",
        title: "Промышленные скрубберы под заказ",
        title2: "Расчёт за 1 день",
        text: "Изготавливаем по ТЗ. Гарантия 24 мес. Доставка по РФ.",
        cluster_filter: { cluster_id_pattern: "^cl04$" },
      },
    ];
    const result = pickAdTemplate(
      "cl04",
      "transactional",
      templates as any,
      "agent-provided",
      "https://example.com"
    );
    expect(result.title).toBe("Промышленные скрубберы под заказ");
    expect(result.title).not.toBe("cl04");
  });

  it("falls back to placeholder when templates is empty/undefined", () => {
    const result = pickAdTemplate(
      "cl04",
      "transactional",
      undefined,
      "agent-provided",
      "https://example.com"
    );
    expect(result.title).toBe("cl04");
  });

  it("uses fallback strategy → placeholder even when templates exist", () => {
    const templates = [
      {
        variant_label: "v1",
        title: "ignored",
        text: "some text",
        cluster_filter: { cluster_id_pattern: "^cl04$" },
      },
    ];
    const result = pickAdTemplate(
      "cl04",
      "transactional",
      templates as any,
      "fallback-template",
      "https://example.com"
    );
    expect(result.title).toBe("cl04");
  });
});
