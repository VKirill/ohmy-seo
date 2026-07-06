import ExcelJS from "exceljs";
import { existsSync } from "fs";
import { basename, join } from "path";
import { LoadedCampaignBundle } from "./yaml-loader.js";

/**
 * Canonical 5-sheet workbook renderer — the owner's standardized report format
 * for ALL clients. Sheet names and column headers are canon (verbatim):
 *   1. CombinatorialAds        — one row per ad of each group
 *   2. canonical-build-preview — one row per group
 *   3. commander-import        — per group: one ad row, then one row per phrase
 *   4. design-assets           — one row per image of each group
 *   5. QA                      — deterministic render checks
 */
const RENDERER_VERSION = "canonical-v2";
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

/** Style a header row: bold + gray fill + frozen pane. */
function styleHeader(sheet: ExcelJS.Worksheet): void {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = HEADER_FILL;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
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

  // K = max image count across all ads (minimum 2 columns) — shared by sheets 1 and 3
  const imageColumns = Math.max(
    2,
    ...groups.flatMap((gv) => gv.ads.map((a) => a.images.length)),
    ...groups.map((gv) => gv.images.length)
  );

  let lengthWarnCount = 0;

  // -------------------------------------------------------------------------
  // Sheet 1 — CombinatorialAds: one row per ad of each group
  // -------------------------------------------------------------------------
  const combi = wb.addWorksheet("CombinatorialAds");
  combi.columns = [
    { header: "campaign_name", key: "campaign_name", width: 25 },
    { header: "geo", key: "geo", width: 14 },
    { header: "group_name", key: "group_name", width: 25 },
    { header: "cluster_id", key: "cluster_id", width: 10 },
    { header: "landing_url", key: "landing_url", width: 35 },
    { header: "display_url", key: "display_url", width: 20 },
    ...Array.from({ length: 7 }, (_, i) => ({
      header: `headline_${i + 1}`, key: `headline_${i + 1}`, width: 30,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      header: `text_${i + 1}`, key: `text_${i + 1}`, width: 42,
    })),
    ...Array.from({ length: imageColumns }, (_, i) => ({
      header: `image_${i + 1}`, key: `image_${i + 1}`, width: 35,
    })),
    { header: "sitelink_titles", key: "sitelink_titles", width: 45 },
    { header: "sitelink_descs", key: "sitelink_descs", width: 55 },
    { header: "sitelink_urls", key: "sitelink_urls", width: 55 },
    { header: "callouts", key: "callouts", width: 40 },
    { header: "group_minus_words", key: "group_minus_words", width: 30 },
    { header: "campaign_minus_words", key: "campaign_minus_words", width: 30 },
  ];
  styleHeader(combi);

  let adRowCount = 0;
  for (const gv of groups) {
    for (const ad of gv.ads) {
      const rowData: Record<string, string> = {
        campaign_name: camp.Name,
        geo: gv.geo,
        group_name: gv.name,
        cluster_id: gv.clusterId,
        landing_url: ad.landing,
        display_url: netloc(ad.landing),
        sitelink_titles: gv.slTitlesJoined,
        sitelink_descs: gv.slDescsJoined,
        sitelink_urls: gv.slUrlsJoined,
        callouts: gv.calloutsJoined,
        group_minus_words: gv.groupMinus,
        campaign_minus_words: campaignMinus,
      };
      for (let i = 0; i < 7; i++) rowData[`headline_${i + 1}`] = ad.headlines[i] ?? "";
      for (let i = 0; i < 3; i++) rowData[`text_${i + 1}`] = ad.texts[i] ?? "";
      for (let i = 0; i < imageColumns; i++) rowData[`image_${i + 1}`] = ad.images[i]?.value ?? "";

      const row = combi.addRow(rowData);

      // Length limits — red fill + warning per offending cell (56 / 81)
      ad.headlines.forEach((h, i) => {
        if (h.length > 56) {
          row.getCell(`headline_${i + 1}`).fill = RED_FILL;
          warnings.push(`${gv.name}: headline_${i + 1} too long (${h.length}/56)`);
          lengthWarnCount++;
        }
      });
      ad.texts.forEach((t, i) => {
        if (t.length > 81) {
          row.getCell(`text_${i + 1}`).fill = RED_FILL;
          warnings.push(`${gv.name}: text_${i + 1} too long (${t.length}/81)`);
          lengthWarnCount++;
        }
      });

      // Sitelinks/callouts issues — highlight on every row of the group
      if (gv.slTitlesBad) row.getCell("sitelink_titles").fill = RED_FILL;
      if (gv.slDescriptionsBad) row.getCell("sitelink_descs").fill = RED_FILL;
      if (gv.calloutsBad) row.getCell("callouts").fill = RED_FILL;

      adRowCount++;
    }
  }

  // -------------------------------------------------------------------------
  // Sheet 2 — canonical-build-preview: one row per group
  // -------------------------------------------------------------------------
  const preview = wb.addWorksheet("canonical-build-preview");
  preview.columns = [
    { header: "Кампания", key: "campaign", width: 25 },
    { header: "Группа", key: "group", width: 25 },
    { header: "Тип услуги", key: "service_type", width: 20 },
    { header: "Аудитория", key: "audience", width: 40 },
    { header: "Интент", key: "intent", width: 15 },
    { header: "Ключевые запросы (wordstat)", key: "keywords", width: 60 },
    ...Array.from({ length: 7 }, (_, i) => ({
      header: `Заголовок ${i + 1}`, key: `h${i + 1}`, width: 30,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      header: `Текст ${i + 1}`, key: `t${i + 1}`, width: 42,
    })),
  ];
  styleHeader(preview);

  for (let gi = 0; gi < groups.length; gi++) {
    const gv = groups[gi];
    const meta = bundle.groups[gi]._meta;
    const audience = metaString(meta, "persona") || metaString(meta, "audience");
    const rowData: Record<string, string> = {
      campaign: camp.Name,
      group: gv.name,
      service_type: metaString(meta, "service_type"),
      audience: audience.slice(0, 80),
      intent: metaString(meta, "intent"),
      keywords: gv.keywordsJoined,
    };
    for (let i = 0; i < 7; i++) rowData[`h${i + 1}`] = gv.pool.headlines[i] ?? "";
    for (let i = 0; i < 3; i++) rowData[`t${i + 1}`] = gv.pool.texts[i] ?? "";
    preview.addRow(rowData);
  }

  // -------------------------------------------------------------------------
  // Sheet 3 — commander-import: per group, one ad row then one row per phrase
  // -------------------------------------------------------------------------
  const commander = wb.addWorksheet("commander-import");
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
  styleHeader(commander);

  for (const gv of groups) {
    // Ad row: texts/links/extensions/images filled, phrase empty, campaign minus filled
    const adRow: Record<string, string> = {
      camp_type: "Единая перфоманс-кампания",
      camp_name: camp.Name,
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

    // Phrase rows: only type/campaign/group/phrase/region/link/display/group-minus
    for (const kw of gv.keywords) {
      commander.addRow({
        camp_type: "Единая перфоманс-кампания",
        camp_name: camp.Name,
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
  // Sheet 4 — design-assets: one row per image of each group
  // -------------------------------------------------------------------------
  const assets = wb.addWorksheet("design-assets");
  assets.columns = [
    { header: "cluster_id", key: "cluster_id", width: 10 },
    { header: "group_name", key: "group_name", width: 25 },
    { header: "image_path", key: "image_path", width: 60 },
    { header: "file_exists", key: "file_exists", width: 12 },
  ];
  styleHeader(assets);

  for (const gv of groups) {
    for (const img of gv.images) {
      const fileExists =
        img.kind === "file"
          ? (existsSync(img.value) ? "True" : "False")
          : img.kind === "url"
            ? "url"
            : "";
      assets.addRow({
        cluster_id: gv.clusterId,
        group_name: gv.name,
        image_path: img.value,
        file_exists: fileExists,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Sheet 5 — QA: deterministic render checks
  // -------------------------------------------------------------------------
  const qa = wb.addWorksheet("QA");
  qa.columns = [
    { header: "check", key: "check", width: 32 },
    { header: "status", key: "status", width: 8 },
    { header: "details", key: "details", width: 80 },
  ];
  styleHeader(qa);

  qa.addRow({
    check: "canonical_renderer_used",
    status: "OK",
    details: `${RENDERER_VERSION} (${RENDERER_PATH})`,
  });
  qa.addRow({ check: "groups_count", status: "OK", details: String(groups.length) });
  qa.addRow({ check: "ads_count", status: "OK", details: String(adRowCount) });

  const sitelinksShort = groups.filter((gv) => !gv.sitelinksComplete).map((gv) => gv.name);
  qa.addRow({
    check: "sitelinks_8_with_descriptions",
    status: sitelinksShort.length > 0 ? "WARN" : "OK",
    details: sitelinksShort.length > 0
      ? `short: ${sitelinksShort.join(", ")}`
      : "all groups have 8 sitelinks with descriptions",
  });

  const calloutsShort = groups.filter((gv) => !gv.calloutsEnough).map((gv) => gv.name);
  qa.addRow({
    check: "callouts_min_4",
    status: calloutsShort.length > 0 ? "WARN" : "OK",
    details: calloutsShort.length > 0
      ? `below 4: ${calloutsShort.join(", ")}`
      : "all groups have at least 4 callouts",
  });

  const calloutSets = new Set(groups.map((gv) => JSON.stringify(gv.callouts)));
  const allSame = groups.length > 1 && calloutSets.size === 1;
  qa.addRow({
    check: "callout_sets_differentiated",
    status: allSame ? "WARN" : "OK",
    details: allSame
      ? `all ${groups.length} groups share the same callout set`
      : `${calloutSets.size} distinct callout sets across ${groups.length} groups`,
  });

  const unresolvedRefs = [
    ...new Set(
      groups.flatMap((gv) =>
        gv.ads.flatMap((ad) => ad.images.filter((img) => img.unresolved).map((img) => img.value))
      )
    ),
  ];
  qa.addRow({
    check: "images_resolved",
    status: unresolvedRefs.length > 0 ? "WARN" : "OK",
    details: unresolvedRefs.length > 0
      ? `${unresolvedRefs.length} unresolved image refs: ${unresolvedRefs.join(", ")}`
      : "all image refs resolved",
  });

  qa.addRow({
    check: "length_limits",
    status: lengthWarnCount > 0 ? "WARN" : "OK",
    details: lengthWarnCount > 0
      ? `${lengthWarnCount} length warnings (56/81)`
      : "no 56/81 violations",
  });

  await wb.xlsx.writeFile(outputPath);

  return { path: outputPath, rows: adRowCount, warnings };
}

export function defaultXlsxPath(folder: string): string {
  return join(folder, `${basename(folder)}.xlsx`);
}
