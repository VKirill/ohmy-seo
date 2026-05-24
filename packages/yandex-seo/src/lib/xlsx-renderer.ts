import ExcelJS from "exceljs";
import { LoadedCampaignBundle } from "./yaml-loader.js";
import { basename, join } from "path";

const COLUMNS: Partial<ExcelJS.Column>[] = [
  // Campaign block
  { header: "Кампания", key: "campaign_name", width: 25 },
  { header: "Camp.Type", key: "campaign_type", width: 15 },
  { header: "Бюджет ₽", key: "budget", width: 10 },
  { header: "Гео", key: "geo", width: 15 },
  { header: "Стратегия", key: "strategy", width: 18 },
  { header: "Стартдата", key: "start_date", width: 12 },
  { header: "Metrika ID", key: "metrika_counter", width: 12 },
  { header: "Goal ID", key: "metrika_goal", width: 12 },
  { header: "UTM шаблон", key: "utm", width: 50 },

  // Promo + sitelinks
  { header: "Promo тип", key: "promo_type", width: 12 },
  { header: "Promo значение", key: "promo_value", width: 12 },
  { header: "Promo до", key: "promo_end", width: 12 },
  { header: "Промокод", key: "promo_code", width: 15 },
  { header: "SL1 заголовок", key: "sl1_title", width: 20 },
  { header: "SL1 URL", key: "sl1_url", width: 30 },
  { header: "SL2 заголовок", key: "sl2_title", width: 20 },
  { header: "SL2 URL", key: "sl2_url", width: 30 },
  { header: "SL3 заголовок", key: "sl3_title", width: 20 },
  { header: "SL3 URL", key: "sl3_url", width: 30 },
  { header: "SL4 заголовок", key: "sl4_title", width: 20 },
  { header: "SL4 URL", key: "sl4_url", width: 30 },

  // Group block
  { header: "Группа", key: "group_name", width: 25 },
  { header: "Group.Type", key: "group_type", width: 18 },
  { header: "Intent", key: "intent", width: 12 },
  { header: "Кластер", key: "cluster_id", width: 8 },
  { header: "Ключевые фразы", key: "keywords", width: 60 },
  { header: "Минус-слова", key: "negatives", width: 30 },

  // Autotargeting (6 yes/no columns)
  { header: "AT-TARGET", key: "at_target", width: 9 },
  { header: "AT-ALTERN", key: "at_alt", width: 9 },
  { header: "AT-COMPET", key: "at_comp", width: 9 },
  { header: "AT-ACCESS", key: "at_acc", width: 9 },
  { header: "AT-BROAD", key: "at_broad", width: 9 },
  { header: "AT-EXACT", key: "at_exact", width: 9 },

  // Ad
  { header: "Variant", key: "variant", width: 8 },
  { header: "Ad.Type", key: "ad_type", width: 16 },
  { header: "Заголовок", key: "title", width: 35 },
  { header: "Lim 56", key: "title_len", width: 8 },
  { header: "2-й загол.", key: "title2", width: 25 },
  { header: "Lim 30", key: "title2_len", width: 8 },
  { header: "Текст", key: "text", width: 45 },
  { header: "Lim 81", key: "text_len", width: 8 },
  { header: "URL", key: "href", width: 35 },
  { header: "Картинка", key: "image", width: 20 },
];

export async function renderCampaignBundleToXlsx(
  bundle: LoadedCampaignBundle,
  outputPath: string
): Promise<{ path: string; rows: number; warnings: string[] }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ohmy-seo Direct upload pipeline";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Кампании-загрузка");
  sheet.columns = COLUMNS;
  sheet.views = [{ state: "frozen", xSplit: 5, ySplit: 1 }];

  // Bold header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0E0" },
  };

  // Extract campaign-level data (repeated per row)
  const camp = bundle.campaign.campaign;
  const tc = camp.TextCampaign;
  const counterId = tc?.CounterIds?.Items?.[0] ?? "";
  const goalId = tc?.PriorityGoals?.Items?.[0]?.GoalId ?? "";
  const sl = bundle.campaign.sitelinks_set?.Sitelinks ?? [];
  const promo = bundle.campaign.promo_extension?.AdExtension.PromoExtension;
  const budgetRub = camp.DailyBudget.Amount / 1_000_000;
  const strategy =
    tc?.BiddingStrategy?.Search?.BiddingStrategyType ?? "";

  const warnings: string[] = [];
  let rowCount = 0;

  const red = {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: "FFFFC0C0" },
  };

  // Flatten: 1 row per ad in each group
  for (const g of bundle.groups) {
    const keywordsConcat = g.keywords.map((k) => k.Keyword).join("; ");
    const negativesConcat = g.negative_keywords?.Items?.join("; ") ?? "";

    // Build autotargeting map
    const atMap: Record<string, string> = {
      TARGET_QUERIES: "—",
      ALTERNATIVE_QUERIES: "—",
      COMPETITOR_QUERIES: "—",
      ACCESSORY_QUERIES: "—",
      BROAD_MATCH: "—",
      EXACT_MENTION: "—",
    };
    for (const item of g.group.AutoTargetingCategories?.Items ?? []) {
      atMap[item.Category] = item.Value;
    }

    for (const ad of g.ads) {
      let title = "";
      let title2 = "";
      let text = "";
      let href = "";
      let image = "";

      if (ad.Type === "TEXT_AD") {
        title = ad.TextAd.Title;
        title2 = ad.TextAd.Title2 ?? "";
        text = ad.TextAd.Text;
        href = ad.TextAd.Href;
        image =
          typeof ad.TextAd.AdImageHash === "string"
            ? ad.TextAd.AdImageHash
            : "";
      } else if (ad.Type === "TEXT_IMAGE_AD") {
        title = ad.TextImageAd.Title;
        title2 = ad.TextImageAd.Title2 ?? "";
        text = ad.TextImageAd.Text;
        href = ad.TextImageAd.Href;
        image =
          typeof ad.TextImageAd.AdImageHash === "string"
            ? ad.TextImageAd.AdImageHash
            : "";
      } else if (ad.Type === "RESPONSIVE_AD") {
        title = ad.ResponsiveAd.Titles.join("; ");
        title2 = (ad.ResponsiveAd.Title2s ?? []).join("; ");
        text = ad.ResponsiveAd.Texts.join("; ");
        href = ad.ResponsiveAd.Hrefs.join("; ");
        image = (ad.ResponsiveAd.ImageHashes ?? [])
          .filter((h): h is string => typeof h === "string")
          .join("; ");
      }

      const row = sheet.addRow({
        campaign_name: camp.Name,
        campaign_type: camp.Type,
        budget: budgetRub,
        geo: g.group.RegionIds.join(", "),
        strategy,
        start_date: camp.StartDate,
        metrika_counter: counterId,
        metrika_goal: goalId,
        utm: tc?.TrackingParams ?? "",
        promo_type: promo?.PromotionType ?? "",
        promo_value: promo?.Discount ?? "",
        promo_end: promo?.EndDate ?? "",
        promo_code: promo?.PromoCode ?? "",
        sl1_title: sl[0]?.Title ?? "",
        sl1_url: sl[0]?.Href ?? "",
        sl2_title: sl[1]?.Title ?? "",
        sl2_url: sl[1]?.Href ?? "",
        sl3_title: sl[2]?.Title ?? "",
        sl3_url: sl[2]?.Href ?? "",
        sl4_title: sl[3]?.Title ?? "",
        sl4_url: sl[3]?.Href ?? "",
        group_name: g.group.Name,
        group_type: g.group.Type,
        intent: g._meta?.intent ?? "",
        cluster_id: g._meta?.cluster_id ?? "",
        keywords: keywordsConcat,
        negatives: negativesConcat,
        at_target: atMap["TARGET_QUERIES"],
        at_alt: atMap["ALTERNATIVE_QUERIES"],
        at_comp: atMap["COMPETITOR_QUERIES"],
        at_acc: atMap["ACCESSORY_QUERIES"],
        at_broad: atMap["BROAD_MATCH"],
        at_exact: atMap["EXACT_MENTION"],
        variant: ad.variant_id ?? "",
        ad_type: ad.Type,
        title,
        title_len: title.length,
        title2,
        title2_len: title2.length,
        text,
        text_len: text.length,
        href,
        image,
      });

      // Conditional formatting — red fill if limits exceeded
      if (ad.Type !== "RESPONSIVE_AD") {
        if (title.length > 56) {
          row.getCell("title").fill = red;
          row.getCell("title_len").fill = red;
          warnings.push(
            `${g.group.Name} variant=${ad.variant_id ?? "?"}: title too long (${title.length}/56)`
          );
        }
        if (title2.length > 30) {
          row.getCell("title2").fill = red;
          row.getCell("title2_len").fill = red;
        }
        if (text.length > 81) {
          row.getCell("text").fill = red;
          row.getCell("text_len").fill = red;
          warnings.push(
            `${g.group.Name} variant=${ad.variant_id ?? "?"}: text too long (${text.length}/81)`
          );
        }
      }
      if (ad.Type === "RESPONSIVE_AD" && !image) {
        row.getCell("image").fill = red;
        warnings.push(
          `${g.group.Name} variant=${ad.variant_id ?? "?"}: RESPONSIVE_AD missing image`
        );
      }

      rowCount++;
    }
  }

  // Summary sheet
  const summary = wb.addWorksheet("Сводка");
  summary.columns = [
    { header: "Метрика", key: "metric", width: 20 },
    { header: "Значение", key: "value", width: 15 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.addRow({ metric: "Всего кампаний", value: 1 });
  summary.addRow({ metric: "Всего групп", value: bundle.groups.length });
  summary.addRow({ metric: "Всего объявлений", value: rowCount });
  summary.addRow({
    metric: "Всего ключей",
    value: bundle.groups.reduce((s, g) => s + g.keywords.length, 0),
  });
  summary.addRow({ metric: "Warnings", value: warnings.length });

  await wb.xlsx.writeFile(outputPath);

  return { path: outputPath, rows: rowCount, warnings };
}

export function defaultXlsxPath(folder: string): string {
  return join(folder, `${basename(folder)}.xlsx`);
}
