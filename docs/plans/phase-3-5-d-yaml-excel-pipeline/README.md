# Phase 3.5.D — YAML Authoring + Excel Review + Extended Pipeline

## Scope

Phase 3.5.D extends the ohmy-seo Yandex Direct upload pipeline with a
human-readable YAML authoring format and an Excel-based review layer,
plus full coverage of six feature areas that were absent from the CSV
pipeline introduced in Phase 3.5.C.

## Six Feature Areas

1. **Sitelinks** — per-ad SitelinksSet entities (up to 8 sitelinks each with
   Title, Description, Href); referenced from TextAd, TextImageAd, ResponsiveAd
   via `SitelinksSetId`.

2. **PromoExtension** — campaign- or group-level promotional supplement
   (type: Скидка/Выгода/Кешбэк/Подарок/Бесплатно/Рассрочка 0%;
   amount + unit; optional PromoCode and date range; separate Href allowed).

3. **UTM / TrackingParams** — `TextCampaign.TrackingParams` string attached at
   campaign level; dynamically resolved per-ad by the pipeline with
   `{keyword}`, `{ad_id}`, etc. macros before upload.

4. **AutoTargeting** — `AdGroup.AutoTargetingCategories.Items` array with
   per-category `Value: YES|NO` flags (TARGET_QUERIES, NARROW_QUERIES,
   BROAD_MATCH, ALTERNATIVE_QUERIES, ACCESSORY_QUERIES; brand sub-filters in
   UNIFIED_AD_GROUP).

5. **Multi-type ads in a single group** — a single YAML `group` block can
   declare both `TEXT_AD` and `TEXT_IMAGE_AD` variants; the pipeline uploads
   them in one AdGroups.add pass and routes to the correct Ads.add sub-object.

6. **ResponsiveAd** — `Ad.Type: RESPONSIVE_AD` targeting `UNIFIED_AD_GROUP`
   inside a `UNIFIED_PERFORMANCE_CAMPAIGN`; multi-value arrays for
   Titles / Title2s / Texts / Hrefs / ImageHashes / VideoHashes.
   Distinct from TextImageAd, which the old pipeline mislabeled as "unified".

## Deliverables

- `direct-api-naming-map.md` — authoritative field / enum / sub-object map
  between the Yandex Direct v5 API and ohmy-seo tooling conventions.
- YAML schema definition (Phase 3.5.D impl sprint).
- Excel template generator (Phase 3.5.D impl sprint).
- Extended upload pipeline (`yaml-upload-pipeline.ts`).

## Key Constraint

The API field namespace is PascalCase and enums are UPPER_SNAKE_CASE.
The new YAML schema mirrors the API EXACTLY. Existing tool input parameters
(snake_case) are Tier 2 optional renames and do not block this phase.
