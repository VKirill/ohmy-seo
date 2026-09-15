import ExcelJS from "exceljs";
import { basename, join } from "path";
import { LoadedCampaignBundle } from "./yaml-loader.js";

/**
 * Direct campaign workbook renderer — 3 sheets, owner-friendly:
 *   1. 01_Превью_для_Кирилла — таблица, ОДНА строка = ОДНА группа (одно объявление);
 *      ключи группы списком в ячейке. Первый/активный лист.
 *   2. Импорт_Коммандер      — плоский формат для ручного импорта в Директ Коммандер
 *      (строка объявления + по строке на фразу).
 *   3. Просмотр_объявлений   — визуальный рендер каждого объявления как в выдаче Яндекса
 *      (заголовок, ссылка, текст, сетка быстрых ссылок с описаниями, уточнения).
 */
const RENDERER_VERSION = "canonical-v4";
const RENDERER_PATH = "packages/yandex-seo/src/lib/xlsx-renderer.ts";

const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE0E0E0" },
};
const RED_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFC0C0" },
};

// Colours for the visual (SERP-like) sheet.
const TITLE_BLUE = "FF0B41CD"; // ad title / sitelink title
const URL_GREEN = "FF006621"; // display url
const DESC_GREY = "FF545454"; // descriptions / secondary text

/** Human-readable region labels; unknown ids are rendered as the raw number. */
const GEO_NAMES: Record<number, string> = {
  225: "РФ",
  1: "МСК+МО",
  213: "Москва",
  2: "СПб",
};

function geoLabel(regionIds: number[]): string {
  return regionIds.map((id) => GEO_NAMES[id] ?? String(id)).join("/");
}

/** netloc (host) of a URL; empty string when unparsable. */
function netloc(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

type ImageDef = {
  source: "url" | "file" | "base64";
  url?: string;
  path?: string;
  base64?: string;
};

interface ResolvedImage {
  /** Display value: url for source=url, path for source=file, literal/key otherwise. */
  value: string;
  kind: "url" | "file" | "other";
  /** true when the value was a ${...} ref with no match in campaign.images */
  unresolved: boolean;
}

/**
 * Resolve an ImageHash entry to a displayable asset reference.
 * Accepts refs "${key}" and "${image.key.Hash}" pointing at bundle.campaign.images:
 * source url → url, source file → path. Literal strings pass through as-is.
 */
function resolveImage(
  raw: string,
  images: Record<string, ImageDef> | undefined
): ResolvedImage {
  const refMatch = /^\$\{(.+)\}$/.exec(raw);
  if (!refMatch) {
    const isUrl = /^https?:\/\//i.test(raw);
    return { value: raw, kind: isUrl ? "url" : "other", unresolved: false };
  }
  const inner = refMatch[1];
  const key = /^image\.(.+)\.Hash$/.exec(inner)?.[1] ?? inner;
  const def = images?.[key];
  if (!def) return { value: raw, kind: "other", unresolved: true };
  if (def.source === "url" && def.url) return { value: def.url, kind: "url", unresolved: false };
  if (def.source === "file" && def.path) return { value: def.path, kind: "file", unresolved: false };
  // base64 or incomplete definition — nothing to point at, show the key
  return { value: key, kind: "other", unresolved: false };
}

/** Read an optional string field from the group's _meta (passthrough keys). */
function metaString(meta: unknown, key: string): string {
  const v = (meta as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" ? v : "";
}

type Group = LoadedCampaignBundle["groups"][number];
type Ad = Group["ads"][number];

interface AdView {
  headlines: string[]; // ≤7
  texts: string[]; // ≤3
  landing: string;
  images: ResolvedImage[];
}

function extractAdView(ad: Ad, images: Record<string, ImageDef> | undefined): AdView {
  if (ad.Type === "TEXT_AD") {
    const imgs = typeof ad.TextAd.AdImageHash === "string"
      ? [resolveImage(ad.TextAd.AdImageHash, images)]
      : [];
    return {
      headlines: [ad.TextAd.Title, ad.TextAd.Title2].filter((h): h is string => !!h),
      texts: [ad.TextAd.Text],
      landing: ad.TextAd.Href,
      images: imgs,
    };
  }
  if (ad.Type === "TEXT_IMAGE_AD") {
    return {
      headlines: [ad.TextImageAd.Title, ad.TextImageAd.Title2].filter((h): h is string => !!h),
      texts: [ad.TextImageAd.Text],
      landing: ad.TextImageAd.Href,
      images: typeof ad.TextImageAd.AdImageHash === "string"
        ? [resolveImage(ad.TextImageAd.AdImageHash, images)]
        : [],
    };
  }
  if (ad.Type === "RESPONSIVE_AD") {
    return {
      headlines: ad.ResponsiveAd.Titles.slice(0, 7),
      texts: ad.ResponsiveAd.Texts.slice(0, 3),
      landing: ad.ResponsiveAd.Hrefs[0] ?? "",
      images: (ad.ResponsiveAd.ImageHashes ?? [])
        .filter((h): h is string => typeof h === "string")
        .map((h) => resolveImage(h, images)),
    };
  }
  if (ad.Type === "IMAGE_AD") {
    return {
      headlines: [],
      texts: [],
      landing: ad.ImageAd.Href,
      images: typeof ad.ImageAd.AdImageHash === "string"
        ? [resolveImage(ad.ImageAd.AdImageHash, images)]
        : [],
    };
  }
  if (ad.Type === "DYNAMIC_TEXT_AD") {
    return { headlines: [], texts: [ad.DynamicTextAd.Text], landing: "", images: [] };
  }
  // MOBILE_APP_AD and any future stub types
  return { headlines: [], texts: [], landing: "", images: [] };
}

interface GroupView {
  name: string;
  clusterId: string;
  geo: string;
  keywords: string[];
  keywordsJoined: string;
  groupMinus: string;
  sitelinks: Array<{ Title: string; Description?: string; Href: string }>;
  callouts: string[];
  slTitlesJoined: string;
  slDescsJoined: string;
  slUrlsJoined: string;
  calloutsJoined: string;
  slTitlesBad: boolean;
  slDescriptionsBad: boolean;
  calloutsBad: boolean;
  sitelinksComplete: boolean; // 8 links, each with a Description
  calloutsEnough: boolean; // ≥ 4 callouts
  ads: AdView[];
  pool: { headlines: string[]; texts: string[] };
  images: ResolvedImage[]; // union across ads, deduped by value
  landing: string;
  display: string;
}

function buildGroupView(
  g: Group,
  campaignSitelinks: Array<{ Title: string; Description?: string; Href: string }>,
  campaignCallouts: string[],
  images: Record<string, ImageDef> | undefined,
  warnings: string[]
): GroupView {
  const name = g.group.Name;

  // Resolve sitelinks/callouts: group-level override wins, else campaign-level
  const sl = g.sitelinks_set?.Sitelinks ?? campaignSitelinks;
  const callouts = g.callouts ?? campaignCallouts;

  // Extension checks — warn once per group, highlight on every row of the group
  let slTitlesBad = false;
  let slDescriptionsBad = false;
  let calloutsBad = false;
  if (sl.length < 8) {
    slTitlesBad = true;
    warnings.push(`${name}: sitelinks count ${sl.length}/8`);
  }
  for (const s of sl) {
    if (s.Title.length > 30) {
      slTitlesBad = true;
      warnings.push(`${name}: sitelink title too long (${s.Title.length}/30): ${s.Title}`);
    }
    if (!s.Description) {
      slDescriptionsBad = true;
      warnings.push(`${name}: sitelink "${s.Title}" has no Description`);
    } else if (s.Description.length > 60) {
      slDescriptionsBad = true;
      warnings.push(`${name}: sitelink "${s.Title}" Description too long (${s.Description.length}/60)`);
    }
  }
  if (callouts.length < 4) {
    calloutsBad = true;
    warnings.push(`${name}: callouts count ${callouts.length}/4`);
  }
  for (const c of callouts) {
    if (c.length > 25) {
      calloutsBad = true;
      warnings.push(`${name}: callout too long (${c.length}/25): ${c}`);
    }
  }

  const ads = g.ads.map((ad) => extractAdView(ad, images));

  // Headline/text pool for the group: explicit combinatorial block wins,
  // else union across ads (mirrors extractCombinatorialPools derivation).
  let pool: { headlines: string[]; texts: string[] };
  if (g.combinatorial) {
    pool = {
      headlines: g.combinatorial.headlines.slice(0, 7),
      texts: g.combinatorial.texts.slice(0, 3),
    };
  } else {
    const headlineSet = new Set<string>();
    const textSet = new Set<string>();
    for (const ad of ads) {
      for (const h of ad.headlines) headlineSet.add(h);
      for (const t of ad.texts) textSet.add(t);
    }
    pool = {
      headlines: [...headlineSet].slice(0, 7),
      texts: [...textSet].slice(0, 3),
    };
  }

  // Union of images across the group's ads, deduped by resolved value
  const groupImages: ResolvedImage[] = [];
  for (const ad of ads) {
    for (const img of ad.images) {
      if (!groupImages.some((existing) => existing.value === img.value)) {
        groupImages.push(img);
      }
    }
  }

  const landing = ads.find((a) => a.landing)?.landing ?? "";

  return {
    name,
    clusterId: g._meta?.cluster_id ?? "",
    geo: geoLabel(g.group.RegionIds),
    keywords: g.keywords.map((k) => k.Keyword),
    keywordsJoined: g.keywords.map((k) => k.Keyword).join(", "),
    groupMinus: g.negative_keywords?.Items?.join(", ") ?? "",
    sitelinks: sl,
    callouts,
    slTitlesJoined: sl.map((s) => s.Title).join(" || "),
    slDescsJoined: sl.map((s) => s.Description ?? "").join(" || "),
    slUrlsJoined: sl.map((s) => s.Href).join(" || "),
    calloutsJoined: callouts.join(" || "),
    slTitlesBad,
    slDescriptionsBad,
    calloutsBad,
    sitelinksComplete: sl.length >= 8 && sl.every((s) => !!s.Description),
    calloutsEnough: callouts.length >= 4,
    ads,
    pool,
    images: groupImages,
    landing,
    display: netloc(landing),
  };
}

export async function renderCampaignBundleToXlsx(
  bundle: LoadedCampaignBundle,
  outputPath: string
): Promise<{ path: string; rows: number; warnings: string[] }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ohmy-seo Direct upload pipeline";
  wb.created = new Date();

  const camp = bundle.campaign.campaign;
  const campaignSitelinks = bundle.campaign.sitelinks_set?.Sitelinks ?? [];
  const campaignCallouts = bundle.campaign.callouts ?? [];
  const campaignMinus = camp.TextCampaign?.NegativeKeywords?.Items?.join(", ") ?? "";
  const images = bundle.campaign.images as Record<string, ImageDef> | undefined;

  const warnings: string[] = [];
  const groups = bundle.groups.map((g) =>
    buildGroupView(g, campaignSitelinks, campaignCallouts, images, warnings)
  );

  // Multi-campaign: each group names its campaign (group.campaign), else the base
  // campaign Name. Rows are ordered by campaign (then bundle order) so every
  // campaign's groups sit together in the preview; single-campaign bundles keep
  // their original order (one campaign → stable by index).
  const campaignOf = (gi: number): string => bundle.groups[gi].campaign ?? camp.Name;
  const order = groups
    .map((_, i) => i)
    .sort((a, b) => {
      const ca = campaignOf(a);
      const cb = campaignOf(b);
      if (ca !== cb) return ca < cb ? -1 : 1;
      return a - b;
    });

  // K = max image count across all groups (minimum 2 columns).
  const imageColumns = Math.max(
    2,
    ...groups.map((gv) => gv.images.length)
  );

  let lengthWarnCount = 0;

  // -------------------------------------------------------------------------
  // Sheet 1 — 01_Превью_для_Кирилла: owner table, ONE row per group (one ad).
  // -------------------------------------------------------------------------
  const owner = wb.addWorksheet("01_Превью_для_Кирилла");
  owner.columns = [
    { header: "campaign_name", key: "campaign_name", width: 22 },
    { header: "group_id", key: "group_id", width: 10 },
    { header: "group_name", key: "group_name", width: 26 },
    { header: "keywords", key: "keywords", width: 40 },
    { header: "geo", key: "geo", width: 12 },
    { header: "persona", key: "persona", width: 24 },
    { header: "intent", key: "intent", width: 16 },
    ...Array.from({ length: 7 }, (_, i) => ({
      header: `headline_${i + 1}`, key: `headline_${i + 1}`, width: 28,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      header: `text_${i + 1}`, key: `text_${i + 1}`, width: 40,
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      header: `sitelink_${i + 1}`, key: `sitelink_${i + 1}`, width: 22,
    })),
    { header: "sitelink_descs", key: "sitelink_descs", width: 55 },
    { header: "callouts", key: "callouts", width: 40 },
    { header: "href", key: "href", width: 34 },
    ...Array.from({ length: imageColumns }, (_, i) => ({
      header: `image_${i + 1}`, key: `image_${i + 1}`, width: 34,
    })),
    { header: "reviewer_status", key: "reviewer_status", width: 14 },
    { header: "reviewer_notes", key: "reviewer_notes", width: 40 },
  ];
  const ownerHeader = owner.getRow(1);
  ownerHeader.font = { bold: true };
  ownerHeader.fill = HEADER_FILL;
  owner.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];

  for (const gi of order) {
    const gv = groups[gi];
    const meta = bundle.groups[gi]._meta;
    const persona = metaString(meta, "persona") || metaString(meta, "audience");
    const reviewerStatus = metaString(meta, "reviewer_status") || "TBD";
    const rowData: Record<string, string> = {
      campaign_name: campaignOf(gi),
      group_id: gv.clusterId,
      group_name: gv.name,
      keywords: gv.keywordsJoined,
      geo: gv.geo,
      persona: persona.slice(0, 80),
      intent: metaString(meta, "intent"),
      sitelink_descs: gv.slDescsJoined,
      callouts: gv.calloutsJoined,
      href: gv.landing,
      reviewer_status: reviewerStatus,
      reviewer_notes: metaString(meta, "reviewer_notes"),
    };
    for (let i = 0; i < 7; i++) rowData[`headline_${i + 1}`] = gv.pool.headlines[i] ?? "";
    for (let i = 0; i < 3; i++) rowData[`text_${i + 1}`] = gv.pool.texts[i] ?? "";
    for (let i = 0; i < 8; i++) rowData[`sitelink_${i + 1}`] = gv.sitelinks[i]?.Title ?? "";
    for (let i = 0; i < imageColumns; i++) rowData[`image_${i + 1}`] = gv.images[i]?.value ?? "";

    if (gv.keywords.length === 0) {
      rowData.keywords = "TBD";
      warnings.push(`${gv.name}: no keyword/skeleton source`);
    }

    const row = owner.addRow(rowData);

    // Length limits — red fill + warning per offending cell (56 / 81).
    gv.pool.headlines.forEach((h, i) => {
      if (h.length > 56) {
        row.getCell(`headline_${i + 1}`).fill = RED_FILL;
        warnings.push(`${gv.name}: headline_${i + 1} too long (${h.length}/56)`);
        lengthWarnCount++;
      }
    });
    gv.pool.texts.forEach((t, i) => {
      if (t.length > 81) {
        row.getCell(`text_${i + 1}`).fill = RED_FILL;
        warnings.push(`${gv.name}: text_${i + 1} too long (${t.length}/81)`);
        lengthWarnCount++;
      }
    });
    if (gv.name.length > 56) {
      row.getCell("group_name").fill = RED_FILL;
      warnings.push(`${gv.name}: group name too long (${gv.name.length}/56)`);
      lengthWarnCount++;
    }
    if (gv.slTitlesBad) { for (let i = 0; i < 8; i++) row.getCell(`sitelink_${i + 1}`).fill = RED_FILL; }
    if (gv.slDescriptionsBad) row.getCell("sitelink_descs").fill = RED_FILL;
    if (gv.calloutsBad) row.getCell("callouts").fill = RED_FILL;
    if (reviewerStatus === "BLOCK" || reviewerStatus === "WARN") {
      row.getCell("reviewer_status").fill = RED_FILL;
    }
  }
  owner.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: owner.columnCount } };

  // -------------------------------------------------------------------------
  // Sheet 2 — Импорт_Коммандер: per group, one ad row then one row per phrase.
  // Stable Russian column headers for the desktop Direct Commander import.
  // -------------------------------------------------------------------------
  const commander = wb.addWorksheet("Импорт_Коммандер");
  commander.columns = [
    { header: "Тип кампании", key: "camp_type", width: 26 },
    { header: "Название кампании", key: "camp_name", width: 25 },
    { header: "Название группы", key: "group_name", width: 25 },
    { header: "Фраза (с минус-словами)", key: "phrase", width: 40 },
    { header: "Регион", key: "region", width: 14 },
    ...Array.from({ length: 7 }, (_, i) => ({
      header: `Заголовок ${i + 1}`, key: `h${i + 1}`, width: 30,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      header: `Текст ${i + 1}`, key: `t${i + 1}`, width: 42,
    })),
    { header: "Ссылка", key: "href", width: 35 },
    { header: "Отображаемая ссылка", key: "display", width: 20 },
    { header: "Заголовки быстрых ссылок", key: "sl_titles", width: 45 },
    { header: "Описания быстрых ссылок", key: "sl_descs", width: 55 },
    { header: "Адреса быстрых ссылок", key: "sl_urls", width: 55 },
    { header: "Уточнения", key: "callouts", width: 40 },
    { header: "Минус-фразы на группу", key: "group_minus", width: 30 },
    { header: "Минус-фразы на кампанию", key: "campaign_minus", width: 30 },
    ...Array.from({ length: imageColumns }, (_, i) => ({
      header: `Изображение ${i + 1}`, key: `img${i + 1}`, width: 35,
    })),
  ];
  const commanderHeader = commander.getRow(1);
  commanderHeader.font = { bold: true };
  commanderHeader.fill = HEADER_FILL;
  commander.views = [{ state: "frozen", ySplit: 1 }];

  for (const gi of order) {
    const gv = groups[gi];
    const adRow: Record<string, string> = {
      camp_type: "Единая перфоманс-кампания",
      camp_name: campaignOf(gi),
      group_name: gv.name,
      phrase: "",
      region: gv.geo,
      href: gv.landing,
      display: gv.display,
      sl_titles: gv.slTitlesJoined,
      sl_descs: gv.slDescsJoined,
      sl_urls: gv.slUrlsJoined,
      callouts: gv.calloutsJoined,
      group_minus: "",
      campaign_minus: campaignMinus,
    };
    for (let i = 0; i < 7; i++) adRow[`h${i + 1}`] = gv.pool.headlines[i] ?? "";
    for (let i = 0; i < 3; i++) adRow[`t${i + 1}`] = gv.pool.texts[i] ?? "";
    for (let i = 0; i < imageColumns; i++) adRow[`img${i + 1}`] = gv.images[i]?.value ?? "";
    commander.addRow(adRow);

    for (const kw of gv.keywords) {
      commander.addRow({
        camp_type: "Единая перфоманс-кампания",
        camp_name: campaignOf(gi),
        group_name: gv.name,
        phrase: kw,
        region: gv.geo,
        href: gv.landing,
        display: gv.display,
        group_minus: gv.groupMinus,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Sheet 3 — Просмотр_объявлений: visual SERP-like card per group.
  // -------------------------------------------------------------------------
  const view = wb.addWorksheet("Просмотр_объявлений");
  view.getColumn(1).width = 50;
  view.getColumn(2).width = 12;
  view.getColumn(3).width = 50;
  view.getColumn(4).width = 12;

  let r = 1;
  const merge = (row: number, c1: number, c2: number) => view.mergeCells(row, c1, row, c2);
  const wrap = (row: number): void => { view.getRow(row).alignment = { wrapText: true, vertical: "top" }; };
  let currentCampaign: string | null = null;

  for (const gi of order) {
    const gv = groups[gi];
    // campaign banner — emitted once when the campaign changes (multi-campaign bundles)
    const campaignName = campaignOf(gi);
    if (campaignName !== currentCampaign) {
      currentCampaign = campaignName;
      merge(r, 1, 4);
      const banner = view.getCell(r, 1);
      banner.value = `КАМПАНИЯ: ${campaignName}`;
      banner.font = { bold: true, size: 12, color: { argb: TITLE_BLUE } };
      banner.fill = HEADER_FILL;
      r++;
    }
    // group label
    merge(r, 1, 4);
    const lbl = view.getCell(r, 1);
    lbl.value = `▸ ${gv.name}${gv.geo ? "  ·  " + gv.geo : ""}`;
    lbl.font = { bold: true, size: 10, color: { argb: DESC_GREY } };
    r++;

    // title — ONE headline (combinatorial ad shows a single title in SERP)
    merge(r, 1, 4);
    const titleCell = view.getCell(r, 1);
    titleCell.value = gv.pool.headlines[0] ?? "";
    titleCell.font = { bold: true, size: 13, color: { argb: TITLE_BLUE } };
    wrap(r);
    r++;

    // display url line
    merge(r, 1, 4);
    const urlCell = view.getCell(r, 1);
    urlCell.value = `Промо · ${gv.display || netloc(gv.landing) || gv.landing}`;
    urlCell.font = { size: 11, color: { argb: URL_GREEN } };
    r++;

    // text (t1)
    merge(r, 1, 4);
    const textCell = view.getCell(r, 1);
    textCell.value = gv.pool.texts[0] ?? "";
    textCell.font = { size: 11 };
    wrap(r);
    r++;

    // sitelinks grid: 2 links per row (left A:B, right C:D), title line + desc line
    for (let p = 0; p < 8; p += 2) {
      const left = gv.sitelinks[p];
      const right = gv.sitelinks[p + 1];
      if (!left && !right) break;
      // title line
      merge(r, 1, 2); merge(r, 3, 4);
      if (left) { const c = view.getCell(r, 1); c.value = left.Title; c.font = { bold: true, size: 11, color: { argb: TITLE_BLUE } }; }
      if (right) { const c = view.getCell(r, 3); c.value = right.Title; c.font = { bold: true, size: 11, color: { argb: TITLE_BLUE } }; }
      r++;
      // desc line
      merge(r, 1, 2); merge(r, 3, 4);
      if (left?.Description) { const c = view.getCell(r, 1); c.value = left.Description; c.font = { size: 10, color: { argb: DESC_GREY } }; }
      if (right?.Description) { const c = view.getCell(r, 3); c.value = right.Description; c.font = { size: 10, color: { argb: DESC_GREY } }; }
      wrap(r);
      r++;
    }

    // callouts line
    if (gv.callouts.length) {
      merge(r, 1, 4);
      const c = view.getCell(r, 1);
      c.value = `Уточнения: ${gv.callouts.join(" · ")}`;
      c.font = { size: 10, color: { argb: DESC_GREY } };
      wrap(r);
      r++;
    }

    // full copy listing (all 7 headlines / 3 texts, so the client sees the whole set)
    merge(r, 1, 4);
    const hl = view.getCell(r, 1);
    hl.value = `Заголовки (${gv.pool.headlines.length}): ${gv.pool.headlines.join(" · ")}`;
    hl.font = { italic: true, size: 9, color: { argb: DESC_GREY } };
    wrap(r);
    r++;
    merge(r, 1, 4);
    const tx = view.getCell(r, 1);
    tx.value = `Тексты (${gv.pool.texts.length}): ${gv.pool.texts.join("  |  ")}`;
    tx.font = { italic: true, size: 9, color: { argb: DESC_GREY } };
    wrap(r);
    r++;

    // separator
    r++;
  }

  await wb.xlsx.writeFile(outputPath);

  return { path: outputPath, rows: groups.length, warnings };
}

export function defaultXlsxPath(folder: string): string {
  return join(folder, `${basename(folder)}.xlsx`);
}
