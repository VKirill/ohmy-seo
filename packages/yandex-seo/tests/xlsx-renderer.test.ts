/**
 * xlsx-renderer.test.ts — canonical 5-sheet workbook.
 *
 * Covers:
 *   - Exactly 5 sheets, canonical names in order
 *   - Verbatim column headers per sheet (incl. dynamic image_K columns, K>=2)
 *   - commander-import structure: per group one ad row, then one row per phrase
 *   - ${ref} image resolution to url/path from bundle.campaign.images
 *   - geo mapping to human-readable labels
 *   - warnings + red fill (56/81 limits, sitelinks/callouts completeness)
 *   - QA sheet checks
 */

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { renderCampaignBundleToXlsx } from "../src/lib/xlsx-renderer.js";
import type { LoadedCampaignBundle } from "../src/lib/yaml-loader.js";

const RED_ARGB = "FFFFC0C0";

const SHEET_NAMES = [
  "01_Превью_для_Кирилла",
  "CombinatorialAds",
  "canonical-build-preview",
  "commander-import",
  "design-assets",
  "QA",
];

const OWNER_PREVIEW_HEADERS = [
  "campaign_name", "group_id", "group_name", "keyword", "keyword_type", "persona", "intent",
  ...Array.from({ length: 7 }, (_, i) => `headline_${i + 1}`),
  ...Array.from({ length: 3 }, (_, i) => `text_${i + 1}`),
  ...Array.from({ length: 8 }, (_, i) => `sitelink_${i + 1}`),
  "callouts", "href", "reviewer_status", "reviewer_notes",
];

/** Canonical headers with K image columns (K = 2 in the fixtures below). */
function combiHeaders(k = 2): string[] {
  return [
    "campaign_name", "geo", "group_name", "cluster_id", "landing_url", "display_url",
    ...Array.from({ length: 7 }, (_, i) => `headline_${i + 1}`),
    ...Array.from({ length: 3 }, (_, i) => `text_${i + 1}`),
    ...Array.from({ length: k }, (_, i) => `image_${i + 1}`),
    "sitelink_titles", "sitelink_descs", "sitelink_urls", "callouts",
    "group_minus_words", "campaign_minus_words",
  ];
}

const PREVIEW_HEADERS = [
  "Кампания", "Группа", "Тип услуги", "Аудитория", "Интент", "Ключевые запросы (wordstat)",
  ...Array.from({ length: 7 }, (_, i) => `Заголовок ${i + 1}`),
  ...Array.from({ length: 3 }, (_, i) => `Текст ${i + 1}`),
];

function commanderHeaders(k = 2): string[] {
  return [
    "Тип кампании", "Название кампании", "Название группы", "Фраза (с минус-словами)", "Регион",
    ...Array.from({ length: 7 }, (_, i) => `Заголовок ${i + 1}`),
    ...Array.from({ length: 3 }, (_, i) => `Текст ${i + 1}`),
    "Ссылка", "Отображаемая ссылка",
    "Заголовки быстрых ссылок", "Описания быстрых ссылок", "Адреса быстрых ссылок", "Уточнения",
    "Минус-фразы на группу", "Минус-фразы на кампанию",
    ...Array.from({ length: k }, (_, i) => `Изображение ${i + 1}`),
  ];
}

const ASSETS_HEADERS = ["cluster_id", "group_name", "image_path", "file_exists"];
const QA_HEADERS = ["check", "status", "details"];

function makeSitelinks(count: number, withDescription = true) {
  return Array.from({ length: count }, (_, i) => ({
    Title: `Ссылка ${i + 1}`,
    ...(withDescription ? { Description: `Описание ${i + 1}` } : {}),
    Href: `https://example.com/link-${i + 1}`,
  }));
}

function makeResponsiveGroup(
  name: string,
  clusterId: string,
  extra: Record<string, unknown> = {}
) {
  return {
    group: { Name: name, Type: "UNIFIED_AD_GROUP", RegionIds: [213] },
    keywords: [{ Keyword: `купить ${clusterId}` }, { Keyword: `заказать ${clusterId}` }],
    negative_keywords: { Items: ["бесплатно", "своими руками"] },
    ads: [
      {
        Type: "RESPONSIVE_AD" as const,
        ResponsiveAd: {
          Titles: ["Заголовок один", "Заголовок два", "Заголовок три"],
          Texts: ["Текст объявления один"],
          Hrefs: ["https://site.example.ru/landing"],
          ImageHashes: ["${hero}"],
        },
      },
    ],
    _meta: {
      cluster_id: clusterId,
      intent: "transactional",
      service_type: "Монтаж",
      persona: "Инженеры проектных организаций",
    },
    ...extra,
  };
}

function makeBundle(opts: {
  groups: unknown[];
  campaignCallouts?: string[];
  campaignSitelinks?: Array<{ Title: string; Description?: string; Href: string }>;
  images?: Record<string, unknown>;
}): LoadedCampaignBundle {
  return {
    campaign_dir: "/fake",
    campaign: {
      upload_strategy: "one-per-cluster",
      dedupe_by_name: false,
      campaign: {
        Name: "Тестовая кампания",
        Type: "TEXT_CAMPAIGN",
        StartDate: "2026-08-01",
        DailyBudget: { Amount: 300_000_000, Currency: "RUB" },
        TextCampaign: {
          BiddingStrategy: {
            Search: { BiddingStrategyType: "HIGHEST_POSITION" },
            Network: { BiddingStrategyType: "SERVING_OFF" },
          },
          NegativeKeywords: { Items: ["скачать", "реферат"] },
        },
      },
      sitelinks_set: opts.campaignSitelinks ? { Sitelinks: opts.campaignSitelinks } : undefined,
      callouts: opts.campaignCallouts,
      images: opts.images,
    },
    groups: opts.groups,
    validation_errors: [],
  } as unknown as LoadedCampaignBundle;
}

async function renderAndRead(bundle: LoadedCampaignBundle) {
  const dir = mkdtempSync(join(tmpdir(), "xlsx-renderer-test-"));
  const outPath = join(dir, "preview.xlsx");
  const result = await renderCampaignBundleToXlsx(bundle, outPath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(outPath);
  return { result, wb };
}

function headerValues(sheet: ExcelJS.Worksheet): string[] {
  const values: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    values.push(String(cell.value));
  });
  return values;
}

function headerIndex(sheet: ExcelJS.Worksheet): Record<string, number> {
  const map: Record<string, number> = {};
  sheet.getRow(1).eachCell((cell, col) => {
    map[String(cell.value)] = col;
  });
  return map;
}

function cellStr(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  return v === null || v === undefined ? "" : String(v);
}

function qaMap(wb: ExcelJS.Workbook): Record<string, { status: string; details: string }> {
  const qa = wb.getWorksheet("QA")!;
  const map: Record<string, { status: string; details: string }> = {};
  qa.eachRow((row, n) => {
    if (n === 1) return;
    map[cellStr(row, 1)] = { status: cellStr(row, 2), details: cellStr(row, 3) };
  });
  return map;
}

const DEFAULT_IMAGES = {
  hero: { source: "url", url: "https://cdn.example.com/hero.jpg" },
};

function defaultBundle() {
  return makeBundle({
    campaignSitelinks: makeSitelinks(8),
    campaignCallouts: ["Гарантия", "Доставка", "Монтаж", "Опыт 10 лет"],
    images: DEFAULT_IMAGES,
    groups: [
      makeResponsiveGroup("cl01_ventilation", "cl01"),
      makeResponsiveGroup("cl02_heating", "cl02", {
        callouts: ["Скидка 20%", "Выезд замерщика", "Свой склад", "Договор"],
      }),
    ],
  });
}

describe("renderCampaignBundleToXlsx — canonical 6-sheet workbook", () => {
  it("renders exactly the 6 canonical sheets in order, owner preview first", async () => {
    const { wb } = await renderAndRead(defaultBundle());
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(SHEET_NAMES);
    expect(wb.worksheets[0].name).toBe("01_Превью_для_Кирилла");
  });

  it("sheet headers match the canon verbatim", async () => {
    const { wb } = await renderAndRead(defaultBundle());
    expect(headerValues(wb.getWorksheet("01_Превью_для_Кирилла")!)).toEqual(OWNER_PREVIEW_HEADERS);
    expect(headerValues(wb.getWorksheet("CombinatorialAds")!)).toEqual(combiHeaders(2));
    expect(headerValues(wb.getWorksheet("canonical-build-preview")!)).toEqual(PREVIEW_HEADERS);
    expect(headerValues(wb.getWorksheet("commander-import")!)).toEqual(commanderHeaders(2));
    expect(headerValues(wb.getWorksheet("design-assets")!)).toEqual(ASSETS_HEADERS);
    expect(headerValues(wb.getWorksheet("QA")!)).toEqual(QA_HEADERS);
  });

  it("01_Превью_для_Кирилла: one row per keyword, ad copy repeated per group", async () => {
    const { wb } = await renderAndRead(defaultBundle());
    const sheet = wb.getWorksheet("01_Превью_для_Кирилла")!;
    const col = headerIndex(sheet);

    // cl01 + cl02, 2 keywords each → header + 4 keyword rows
    expect(sheet.rowCount).toBe(5);

    const row2 = sheet.getRow(2);
    expect(cellStr(row2, col["campaign_name"])).toBe("Тестовая кампания");
    expect(cellStr(row2, col["group_id"])).toBe("cl01");
    expect(cellStr(row2, col["group_name"])).toBe("cl01_ventilation");
    expect(cellStr(row2, col["keyword"])).toBe("купить cl01");
    expect(cellStr(row2, col["keyword_type"])).toBe("exact");
    expect(cellStr(row2, col["headline_1"])).toBe("Заголовок один");
    expect(cellStr(row2, col["text_1"])).toBe("Текст объявления один");
    expect(cellStr(row2, col["sitelink_1"])).toBe("Ссылка 1");
    expect(cellStr(row2, col["reviewer_status"])).toBe("TBD");

    // Second keyword of cl01 repeats the same ad copy
    const row3 = sheet.getRow(3);
    expect(cellStr(row3, col["keyword"])).toBe("заказать cl01");
    expect(cellStr(row3, col["headline_1"])).toBe("Заголовок один");

    // QA reports the keyword-row count
    expect(qaMap(wb)["preview_keyword_rows"].details).toBe("4");
  });

  it("CombinatorialAds: one row per ad; geo/landing/display/minus-words; rows count returned", async () => {
    const { result, wb } = await renderAndRead(defaultBundle());
    const sheet = wb.getWorksheet("CombinatorialAds")!;
    const col = headerIndex(sheet);
    const row = sheet.getRow(2);

    expect(result.rows).toBe(2); // 2 groups × 1 ad
    expect(cellStr(row, col["campaign_name"])).toBe("Тестовая кампания");
    expect(cellStr(row, col["geo"])).toBe("Москва");
    expect(cellStr(row, col["group_name"])).toBe("cl01_ventilation");
    expect(cellStr(row, col["cluster_id"])).toBe("cl01");
    expect(cellStr(row, col["landing_url"])).toBe("https://site.example.ru/landing");
    expect(cellStr(row, col["display_url"])).toBe("site.example.ru");
    expect(cellStr(row, col["headline_1"])).toBe("Заголовок один");
    expect(cellStr(row, col["headline_3"])).toBe("Заголовок три");
    expect(cellStr(row, col["headline_4"])).toBe("");
    expect(cellStr(row, col["text_1"])).toBe("Текст объявления один");
    expect(cellStr(row, col["sitelink_titles"])).toBe(
      makeSitelinks(8).map((s) => s.Title).join(" || ")
    );
    expect(cellStr(row, col["group_minus_words"])).toBe("бесплатно, своими руками");
    expect(cellStr(row, col["campaign_minus_words"])).toBe("скачать, реферат");
    // Group callouts override on row 3 (cl02)
    expect(cellStr(sheet.getRow(3), col["callouts"])).toBe(
      "Скидка 20% || Выезд замерщика || Свой склад || Договор"
    );
  });

  it("resolves ${ref} images to url (CombinatorialAds + design-assets + QA)", async () => {
    const { wb } = await renderAndRead(defaultBundle());

    const combi = wb.getWorksheet("CombinatorialAds")!;
    const cCol = headerIndex(combi);
    expect(cellStr(combi.getRow(2), cCol["image_1"])).toBe("https://cdn.example.com/hero.jpg");
    expect(cellStr(combi.getRow(2), cCol["image_2"])).toBe("");

    const assets = wb.getWorksheet("design-assets")!;
    const aCol = headerIndex(assets);
    const assetRow = assets.getRow(2);
    expect(cellStr(assetRow, aCol["cluster_id"])).toBe("cl01");
    expect(cellStr(assetRow, aCol["group_name"])).toBe("cl01_ventilation");
    expect(cellStr(assetRow, aCol["image_path"])).toBe("https://cdn.example.com/hero.jpg");
    expect(cellStr(assetRow, aCol["file_exists"])).toBe("url");

    expect(qaMap(wb)["images_resolved"].status).toBe("OK");
  });

  it("commander-import: ad row first, then one row per phrase", async () => {
    const { wb } = await renderAndRead(defaultBundle());
    const sheet = wb.getWorksheet("commander-import")!;
    const col = headerIndex(sheet);

    // Row 2 — ad row of cl01: texts/links/extensions/images filled, phrase empty
    const adRow = sheet.getRow(2);
    expect(cellStr(adRow, col["Тип кампании"])).toBe("Единая перфоманс-кампания");
    expect(cellStr(adRow, col["Название кампании"])).toBe("Тестовая кампания");
    expect(cellStr(adRow, col["Название группы"])).toBe("cl01_ventilation");
    expect(cellStr(adRow, col["Фраза (с минус-словами)"])).toBe("");
    expect(cellStr(adRow, col["Регион"])).toBe("Москва");
    expect(cellStr(adRow, col["Заголовок 1"])).toBe("Заголовок один");
    expect(cellStr(adRow, col["Текст 1"])).toBe("Текст объявления один");
    expect(cellStr(adRow, col["Ссылка"])).toBe("https://site.example.ru/landing");
    expect(cellStr(adRow, col["Отображаемая ссылка"])).toBe("site.example.ru");
    expect(cellStr(adRow, col["Уточнения"])).toBe("Гарантия || Доставка || Монтаж || Опыт 10 лет");
    expect(cellStr(adRow, col["Минус-фразы на группу"])).toBe("");
    expect(cellStr(adRow, col["Минус-фразы на кампанию"])).toBe("скачать, реферат");
    expect(cellStr(adRow, col["Изображение 1"])).toBe("https://cdn.example.com/hero.jpg");

    // Rows 3-4 — phrase rows of cl01: only type/campaign/group/phrase/region/link/display/group-minus
    const phrase1 = sheet.getRow(3);
    expect(cellStr(phrase1, col["Тип кампании"])).toBe("Единая перфоманс-кампания");
    expect(cellStr(phrase1, col["Фраза (с минус-словами)"])).toBe("купить cl01");
    expect(cellStr(phrase1, col["Регион"])).toBe("Москва");
    expect(cellStr(phrase1, col["Ссылка"])).toBe("https://site.example.ru/landing");
    expect(cellStr(phrase1, col["Отображаемая ссылка"])).toBe("site.example.ru");
    expect(cellStr(phrase1, col["Минус-фразы на группу"])).toBe("бесплатно, своими руками");
    expect(cellStr(phrase1, col["Заголовок 1"])).toBe("");
    expect(cellStr(phrase1, col["Текст 1"])).toBe("");
    expect(cellStr(phrase1, col["Уточнения"])).toBe("");
    expect(cellStr(phrase1, col["Минус-фразы на кампанию"])).toBe("");
    expect(cellStr(phrase1, col["Изображение 1"])).toBe("");
    expect(cellStr(sheet.getRow(4), col["Фраза (с минус-словами)"])).toBe("заказать cl01");

    // Row 5 — ad row of cl02
    expect(cellStr(sheet.getRow(5), col["Название группы"])).toBe("cl02_heating");
    expect(cellStr(sheet.getRow(5), col["Фраза (с минус-словами)"])).toBe("");
  });

  it("canonical-build-preview: one row per group with meta and pools", async () => {
    const { wb } = await renderAndRead(defaultBundle());
    const sheet = wb.getWorksheet("canonical-build-preview")!;
    const col = headerIndex(sheet);
    const row = sheet.getRow(2);

    expect(sheet.rowCount).toBe(3); // header + 2 groups
    expect(cellStr(row, col["Кампания"])).toBe("Тестовая кампания");
    expect(cellStr(row, col["Группа"])).toBe("cl01_ventilation");
    expect(cellStr(row, col["Тип услуги"])).toBe("Монтаж");
    expect(cellStr(row, col["Аудитория"])).toBe("Инженеры проектных организаций");
    expect(cellStr(row, col["Интент"])).toBe("transactional");
    expect(cellStr(row, col["Ключевые запросы (wordstat)"])).toBe("купить cl01, заказать cl01");
    expect(cellStr(row, col["Заголовок 1"])).toBe("Заголовок один");
    expect(cellStr(row, col["Текст 1"])).toBe("Текст объявления один");
  });

  it("geo: human-readable labels joined with '/', unknown id as number", async () => {
    const bundle = makeBundle({
      images: DEFAULT_IMAGES,
      groups: [
        makeResponsiveGroup("cl01_multi_geo", "cl01", {
          group: { Name: "cl01_multi_geo", Type: "UNIFIED_AD_GROUP", RegionIds: [213, 2, 999] },
        }),
      ],
    });
    const { wb } = await renderAndRead(bundle);
    const sheet = wb.getWorksheet("CombinatorialAds")!;
    const col = headerIndex(sheet);
    expect(cellStr(sheet.getRow(2), col["geo"])).toBe("Москва/СПб/999");
  });

  it("warnings + red fill: 56/81 limits, <8 sitelinks, missing descriptions, <4 callouts", async () => {
    const longHeadline = "Оч".repeat(29); // 58 > 56
    const longText = "Т".repeat(82); // 82 > 81
    const bundle = makeBundle({
      campaignSitelinks: makeSitelinks(3, false), // 3 links, no descriptions
      campaignCallouts: ["Гарантия", "Доставка"], // only 2 < 4
      images: DEFAULT_IMAGES,
      groups: [
        makeResponsiveGroup("cl01_bad", "cl01", {
          ads: [
            {
              Type: "RESPONSIVE_AD" as const,
              ResponsiveAd: {
                Titles: [longHeadline],
                Texts: [longText],
                Hrefs: ["https://site.example.ru/landing"],
                ImageHashes: ["${hero}"],
              },
            },
          ],
        }),
      ],
    });
    const { result, wb } = await renderAndRead(bundle);

    expect(result.warnings.some((w) => /cl01_bad: headline_1 too long \(58\/56\)/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /cl01_bad: text_1 too long \(82\/81\)/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /cl01_bad: sitelinks count 3\/8/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /has no Description/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /cl01_bad: callouts count 2\/4/.test(w))).toBe(true);

    const sheet = wb.getWorksheet("CombinatorialAds")!;
    const col = headerIndex(sheet);
    const row = sheet.getRow(2);
    expect((row.getCell(col["headline_1"]).fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe(RED_ARGB);
    expect((row.getCell(col["text_1"]).fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe(RED_ARGB);
    expect((row.getCell(col["sitelink_titles"]).fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe(RED_ARGB);
    expect((row.getCell(col["sitelink_descs"]).fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe(RED_ARGB);
    expect((row.getCell(col["callouts"]).fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe(RED_ARGB);

    // QA reflects the same findings
    const qa = qaMap(wb);
    expect(qa["sitelinks_8_with_descriptions"].status).toBe("WARN");
    expect(qa["sitelinks_8_with_descriptions"].details).toContain("cl01_bad");
    expect(qa["callouts_min_4"].status).toBe("WARN");
    expect(qa["length_limits"].status).toBe("WARN");
    expect(qa["length_limits"].details).toContain("2 length warnings");
  });

  it("QA: renderer version, counts, unresolved refs, undifferentiated callout sets", async () => {
    const bundle = makeBundle({
      campaignSitelinks: makeSitelinks(8),
      campaignCallouts: ["Гарантия", "Доставка", "Монтаж", "Опыт 10 лет"],
      images: DEFAULT_IMAGES,
      groups: [
        // Both groups fall back to the SAME campaign callouts → not differentiated
        makeResponsiveGroup("cl01_same", "cl01", {
          ads: [
            {
              Type: "RESPONSIVE_AD" as const,
              ResponsiveAd: {
                Titles: ["Заголовок"],
                Texts: ["Текст"],
                Hrefs: ["https://site.example.ru/a"],
                ImageHashes: ["${missing_ref}"], // no such key in campaign.images
              },
            },
          ],
        }),
        makeResponsiveGroup("cl02_same", "cl02"),
      ],
    });
    const { wb } = await renderAndRead(bundle);
    const qa = qaMap(wb);

    expect(qa["canonical_renderer_used"].status).toBe("OK");
    expect(qa["canonical_renderer_used"].details).toContain("canonical-v3");
    expect(qa["canonical_renderer_used"].details).toContain("xlsx-renderer.ts");
    expect(qa["groups_count"].details).toBe("2");
    expect(qa["ads_count"].details).toBe("2");
    expect(qa["callout_sets_differentiated"].status).toBe("WARN");
    expect(qa["callout_sets_differentiated"].details).toContain("share the same callout set");
    expect(qa["images_resolved"].status).toBe("WARN");
    expect(qa["images_resolved"].details).toContain("${missing_ref}");
  });
});
