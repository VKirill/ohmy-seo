/**
 * xlsx-renderer.test.ts — 3-sheet owner workbook.
 *
 * Covers:
 *   - Exactly 3 sheets, canonical names in order, owner preview first
 *   - Owner sheet: verbatim headers + ONE row per group (one ad), keywords joined
 *   - Импорт_Коммандер: per group one ad row, then one row per phrase
 *   - Просмотр_объявлений: visual card carries group name / title / sitelinks
 *   - length red fill (56/81) on the owner sheet
 */

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { renderCampaignBundleToXlsx } from "../src/lib/xlsx-renderer.js";
import type { LoadedCampaignBundle } from "../src/lib/yaml-loader.js";

const RED_ARGB = "FFFFC0C0";

const SHEET_NAMES = ["01_Превью_для_Кирилла", "Импорт_Коммандер", "Просмотр_объявлений"];

function ownerHeaders(k = 2): string[] {
  return [
    "campaign_name", "group_id", "group_name", "keywords", "geo", "persona", "intent",
    ...Array.from({ length: 7 }, (_, i) => `headline_${i + 1}`),
    ...Array.from({ length: 3 }, (_, i) => `text_${i + 1}`),
    ...Array.from({ length: 8 }, (_, i) => `sitelink_${i + 1}`),
    "sitelink_descs", "callouts", "href",
    ...Array.from({ length: k }, (_, i) => `image_${i + 1}`),
    "reviewer_status", "reviewer_notes",
  ];
}

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

function allCellStrings(sheet: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  sheet.eachRow((row) => row.eachCell((cell) => out.push(String(cell.value ?? ""))));
  return out;
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

describe("renderCampaignBundleToXlsx — 3-sheet owner workbook", () => {
  it("renders exactly the 3 canonical sheets in order, owner preview first", async () => {
    const { wb } = await renderAndRead(defaultBundle());
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(SHEET_NAMES);
    expect(wb.worksheets[0].name).toBe("01_Превью_для_Кирилла");
  });

  it("sheet headers match the canon verbatim", async () => {
    const { wb } = await renderAndRead(defaultBundle());
    expect(headerValues(wb.getWorksheet("01_Превью_для_Кирилла")!)).toEqual(ownerHeaders(2));
    expect(headerValues(wb.getWorksheet("Импорт_Коммандер")!)).toEqual(commanderHeaders(2));
  });

  it("01_Превью_для_Кирилла: one row per group, keywords joined, one ad", async () => {
    const { result, wb } = await renderAndRead(defaultBundle());
    const sheet = wb.getWorksheet("01_Превью_для_Кирилла")!;
    const col = headerIndex(sheet);

    expect(result.rows).toBe(2); // 2 groups
    expect(sheet.rowCount).toBe(3); // header + 2 groups

    const row2 = sheet.getRow(2);
    expect(cellStr(row2, col["campaign_name"])).toBe("Тестовая кампания");
    expect(cellStr(row2, col["group_id"])).toBe("cl01");
    expect(cellStr(row2, col["group_name"])).toBe("cl01_ventilation");
    expect(cellStr(row2, col["keywords"])).toBe("купить cl01, заказать cl01");
    expect(cellStr(row2, col["geo"])).toBe("Москва");
    expect(cellStr(row2, col["persona"])).toBe("Инженеры проектных организаций");
    expect(cellStr(row2, col["headline_1"])).toBe("Заголовок один");
    expect(cellStr(row2, col["headline_3"])).toBe("Заголовок три");
    expect(cellStr(row2, col["headline_4"])).toBe("");
    expect(cellStr(row2, col["text_1"])).toBe("Текст объявления один");
    expect(cellStr(row2, col["sitelink_1"])).toBe("Ссылка 1");
    expect(cellStr(row2, col["sitelink_8"])).toBe("Ссылка 8");
    expect(cellStr(row2, col["sitelink_descs"])).toBe(
      makeSitelinks(8).map((s) => s.Description).join(" || ")
    );
    expect(cellStr(row2, col["href"])).toBe("https://site.example.ru/landing");
    expect(cellStr(row2, col["image_1"])).toBe("https://cdn.example.com/hero.jpg");
    expect(cellStr(row2, col["reviewer_status"])).toBe("TBD");

    // cl02 callouts override on its own row
    expect(cellStr(sheet.getRow(3), col["callouts"])).toBe(
      "Скидка 20% || Выезд замерщика || Свой склад || Договор"
    );
  });

  it("Импорт_Коммандер: ad row first, then one row per phrase", async () => {
    const { wb } = await renderAndRead(defaultBundle());
    const sheet = wb.getWorksheet("Импорт_Коммандер")!;
    const col = headerIndex(sheet);

    const adRow = sheet.getRow(2);
    expect(cellStr(adRow, col["Название группы"])).toBe("cl01_ventilation");
    expect(cellStr(adRow, col["Фраза (с минус-словами)"])).toBe("");
    expect(cellStr(adRow, col["Заголовок 1"])).toBe("Заголовок один");
    expect(cellStr(adRow, col["Текст 1"])).toBe("Текст объявления один");
    expect(cellStr(adRow, col["Ссылка"])).toBe("https://site.example.ru/landing");

    const phrase1 = sheet.getRow(3);
    expect(cellStr(phrase1, col["Фраза (с минус-словами)"])).toBe("купить cl01");
    expect(cellStr(phrase1, col["Заголовок 1"])).toBe(""); // phrase rows have no copy
    expect(cellStr(phrase1, col["Минус-фразы на группу"])).toBe("бесплатно, своими руками");
    expect(cellStr(sheet.getRow(4), col["Фраза (с минус-словами)"])).toBe("заказать cl01");
    expect(cellStr(sheet.getRow(5), col["Название группы"])).toBe("cl02_heating");
  });

  it("Просмотр_объявлений: visual card carries group name, title and sitelinks", async () => {
    const { wb } = await renderAndRead(defaultBundle());
    const sheet = wb.getWorksheet("Просмотр_объявлений")!;
    const cells = allCellStrings(sheet);
    expect(cells.some((c) => c.includes("cl01_ventilation"))).toBe(true);
    // title line = ONE headline (h1), never "h1 — h2" concatenated
    expect(cells.some((c) => c === "Заголовок один")).toBe(true);
    expect(cells.some((c) => c.includes("Заголовок один — Заголовок два"))).toBe(false);
    // url line
    expect(cells.some((c) => c.startsWith("Промо ·"))).toBe(true);
    // a sitelink title
    expect(cells.some((c) => c === "Ссылка 1")).toBe(true);
    // callouts line
    expect(cells.some((c) => c.startsWith("Уточнения:"))).toBe(true);
  });

  it("length limits: >56 headline gets red fill + warning", async () => {
    const longHeadline = "Ф".repeat(60);
    const g = makeResponsiveGroup("cl03_long", "cl03");
    (g.ads[0] as { ResponsiveAd: { Titles: string[] } }).ResponsiveAd.Titles = [
      longHeadline, "нормальный", "ещё один",
    ];
    const { result, wb } = await renderAndRead(
      makeBundle({
        campaignSitelinks: makeSitelinks(8),
        campaignCallouts: ["Гарантия", "Доставка", "Монтаж", "Опыт 10 лет"],
        images: DEFAULT_IMAGES,
        groups: [g],
      })
    );
    const sheet = wb.getWorksheet("01_Превью_для_Кирилла")!;
    const col = headerIndex(sheet);
    const cell = sheet.getRow(2).getCell(col["headline_1"]);
    expect((cell.fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe(RED_ARGB);
    expect(result.warnings.some((w) => w.includes("headline_1 too long"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-campaign preview — group.campaign drives campaign_name per row and
// groups rows by campaign (Брендовые < Целевые by cyrillic code-unit order).
// ---------------------------------------------------------------------------
describe("multi-campaign preview", () => {
  it("campaign_name reflects each group's campaign and rows are grouped by campaign", async () => {
    const bundle = makeBundle({
      groups: [
        makeResponsiveGroup("Бренд группа", "ag37", { campaign: "Брендовые запросы" }),
        makeResponsiveGroup("Целевая группа 1", "ag01", { campaign: "Целевые запросы" }),
        makeResponsiveGroup("Целевая группа 2", "ag02", { campaign: "Целевые запросы" }),
      ],
    });
    const { wb } = await renderAndRead(bundle);
    const owner = wb.getWorksheet("01_Превью_для_Кирилла")!;
    const idx = headerIndex(owner);
    const campCol = idx["campaign_name"];
    const gidCol = idx["group_id"];
    // rows 2..4 ordered by campaign name; within a campaign, bundle order preserved
    expect([
      cellStr(owner.getRow(2), campCol),
      cellStr(owner.getRow(3), campCol),
      cellStr(owner.getRow(4), campCol),
    ]).toEqual(["Брендовые запросы", "Целевые запросы", "Целевые запросы"]);
    expect([cellStr(owner.getRow(3), gidCol), cellStr(owner.getRow(4), gidCol)]).toEqual(["ag01", "ag02"]);
  });

  it("commander sheet 'Название кампании' follows the group's campaign", async () => {
    const bundle = makeBundle({
      groups: [
        makeResponsiveGroup("Целевая", "ag01", { campaign: "Целевые запросы" }),
        makeResponsiveGroup("Бренд", "ag37", { campaign: "Брендовые запросы" }),
      ],
    });
    const { wb } = await renderAndRead(bundle);
    const cmd = wb.getWorksheet("Импорт_Коммандер")!;
    const col = headerIndex(cmd)["Название кампании"];
    // first ad row (row 2) is the Брендовые group (sorted first)
    expect(cellStr(cmd.getRow(2), col)).toBe("Брендовые запросы");
  });

  it("visual sheet emits a КАМПАНИЯ banner per distinct campaign", async () => {
    const bundle = makeBundle({
      groups: [
        makeResponsiveGroup("Целевая", "ag01", { campaign: "Целевые запросы" }),
        makeResponsiveGroup("Бренд", "ag37", { campaign: "Брендовые запросы" }),
      ],
    });
    const { wb } = await renderAndRead(bundle);
    const view = wb.getWorksheet("Просмотр_объявлений")!;
    const all = allCellStrings(view);
    expect(all.some((s) => s === "КАМПАНИЯ: Целевые запросы")).toBe(true);
    expect(all.some((s) => s === "КАМПАНИЯ: Брендовые запросы")).toBe(true);
  });

  it("single-campaign bundle keeps the base campaign name for every row", async () => {
    const bundle = makeBundle({
      groups: [makeResponsiveGroup("Гр1", "c1"), makeResponsiveGroup("Гр2", "c2")],
    });
    const { wb } = await renderAndRead(bundle);
    const owner = wb.getWorksheet("01_Превью_для_Кирилла")!;
    const col = headerIndex(owner)["campaign_name"];
    expect(cellStr(owner.getRow(2), col)).toBe("Тестовая кампания");
    expect(cellStr(owner.getRow(3), col)).toBe("Тестовая кампания");
  });
});
