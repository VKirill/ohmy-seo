# Direct API ↔ ohmy-seo Naming Map (authoritative)

> Version: 2026-05-22. Phase 3.5.D reference document.
> Purpose: single source of truth for field names, enum values, and sub-object
> names between Yandex Direct v5 API and ohmy-seo tooling.
> DO NOT rename or restructure without updating this file and the glossary.

---

## Conventions

| Layer | Case | Example |
|---|---|---|
| API field names | PascalCase | `DailyBudget`, `AdGroupId`, `BiddingStrategyType` |
| API enum values | UPPER_SNAKE_CASE | `TEXT_CAMPAIGN`, `WB_DAILY_BUDGET`, `TARGET_QUERIES` |
| API sub-object names | PascalCase, matches Type value without underscores | `TextCampaign`, `TextAd`, `TextImageAd` |
| New Phase 3.5.D YAML schema | Mirrors API EXACTLY | `Type: TEXT_AD`, `TextAd: { Title: ... }` |
| Existing tool input params | snake_case (Tier 2 optional rename) | `ad_group_id`, `daily_budget_rub`, `counter_ids` |

**Rule:** for every `Type: SOME_TYPE_ENUM` field, the polymorphic sub-object
is named by stripping underscores and title-casing the enum token:
`TEXT_CAMPAIGN` → `TextCampaign`, `MOBILE_APP_AD` → `MobileAppAd`.

---

## 1. Campaign

### 1.1 Campaign.Type enum

| API Type | Sub-object | Implied Group Type | ohmy-seo status |
|---|---|---|---|
| `TEXT_CAMPAIGN` | `TextCampaign` | `TEXT_AD_GROUP` | ✅ supported via `type: "search"\|"rsya"\|"rsya-only"` |
| `UNIFIED_PERFORMANCE_CAMPAIGN` | `UnifiedPerformanceCampaign` | `UNIFIED_AD_GROUP` | ❌ not yet implemented |
| `MOBILE_APP_CAMPAIGN` | `MobileAppCampaign` | `MOBILE_APP_AD_GROUP` | ❌ not implemented |
| `DYNAMIC_TEXT_CAMPAIGN` | `DynamicTextCampaign` | `DYNAMIC_TEXT_AD_GROUP` | ❌ not implemented |
| `SMART_CAMPAIGN` | `SmartCampaign` | `SMART_AD_GROUP` | ❌ not implemented |
| `CPM_BANNER_CAMPAIGN` | `CpmBannerCampaign` | `CPM_BANNER_AD_GROUP` | ❌ not implemented |
| `CPM_VIDEO_CAMPAIGN` | `CpmVideoCampaign` | `CPM_VIDEO_AD_GROUP` | ❌ not implemented |

[source: vendor/yandex-direct-docs-snapshot/docs/campaigns/campaign-settings.md:1]
[source: packages/yandex-seo/src/tools/direct-create-campaign.ts:8]

### 1.2 Campaign common fields

| API field | Type | Required | Notes |
|---|---|---|---|
| `Name` | string | yes | max 255 chars |
| `StartDate` | string | yes | `YYYY-MM-DD`; must be today or future in Moscow time (UTC+3) — see payload-builder quirk 4 |
| `EndDate` | string | no | `YYYY-MM-DD` |
| `Status` | string | read-only | `DRAFT\|ON\|OFF\|SUSPENDED\|ENDED\|ARCHIVED` |
| `RegionIds` | array\<int\> | no | **NOT set at campaign level** — set at AdGroup level; API ignores it on Campaign — quirk 1 |
| `NegativeKeywords` | `{ Items: string[] }` | no | campaign-level exclusions |
| `NegativeKeywordSharedSetIds` | `{ Items: int[] }` | no | shared negative keyword library |
| `TimeTargeting` | object | no | schedule grid |
| `TimeZone` | string | no | `Europe/Moscow` etc. |
| `ClientInfo` | string | no | free-form client label |
| `Tags` | `{ Items: string[] }` | no | campaign tags |
| `DailyBudget` | object | no | **campaign-level limit**; for TEXT_CAMPAIGN lives inside `TextCampaign.BiddingStrategy`, not here |

[source: vendor/yandex-direct-docs-snapshot/docs/campaigns/campaign-settings.md:8]
[source: packages/yandex-seo/src/lib/payload-builder.ts:56]

**Important quirk 1:** `RegionIds` is set at `AdGroup` level, not `Campaign`.
[source: packages/yandex-seo/src/lib/payload-builder.ts:140-162]

### 1.3 TextCampaign sub-object fields

| API field | Type | Notes |
|---|---|---|
| `BiddingStrategy` | object | required; contains `Search` + `Network` sub-objects |
| `Settings` | `{ Items: [{ Option, Value }] }` | e.g. `ADD_METRICA_TAG: YES` |
| `CounterIds` | `{ Items: int[] }` | Yandex Metrika counter IDs |
| `PriorityGoals` | `{ Items: [{ GoalId, Value }] }` | goal weights for `WB_DAILY_BUDGET` strategy |
| `NegativeKeywords` | `{ Items: string[] }` | campaign-level minus-phrases |
| `TrackingParams` | string | UTM template: `utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}&utm_content={ad_id}&utm_term={keyword}` |
| `AttributionModel` | string | `LAST_CLICK_CROSS_DEVICE\|FIRST_CLICK\|LAST_CLICK\|LAST_SIGNIFICANT_CLICK\|AUTO` |
| `RelevantKeywords` | object | autotargeting-related keyword expansion |

[source: packages/yandex-seo/src/tools/direct-create-campaign.ts:83-102]
[source: packages/yandex-seo/src/tools/direct-link-metrika-goals.ts:73-108]

### 1.4 TextCampaign.BiddingStrategy structure

```
TextCampaign:
  BiddingStrategy:
    Search:
      BiddingStrategyType: <SearchStrategyEnum>
      <StrategyObject>: { ... }
    Network:
      BiddingStrategyType: <NetworkStrategyEnum>
      <StrategyObject>: { ... }
```

### 1.5 BiddingStrategy.Search.BiddingStrategyType enum

| Enum value | Sub-object key | Notes |
|---|---|---|
| `HIGHEST_POSITION` | none | manual CPC, no sub-object; valid for Search |
| `WB_DAILY_BUDGET` | `WbDailyBudget` | WB network budget; NOT valid for Search — quirk 2 |
| `AVERAGE_CPC` | `AverageCpc` | target average CPC |
| `AVERAGE_CPA` | `AverageCpa` | target average CPA; requires goal |
| `AVERAGE_ROI` | `AverageRoi` | target ROI; requires goal + revenue value |
| `PAY_FOR_CONVERSION` | `PayForConversion` | pay-per-conversion; requires approved goal |
| `MAXIMUM_COVERAGE` | none | for network; maximizes impressions |
| `WB_MAXIMUM_CLICKS` | `WbMaximumClicks` | weekly spend limit, max clicks |
| `SERVING_OFF` | none | disables placement on this network |

**Quirk 2:** `WB_DAILY_BUDGET` is ONLY valid on the `Network` side. Search
campaigns MUST use `HIGHEST_POSITION` or `AVERAGE_CPC` for Search.
[source: packages/yandex-seo/src/lib/payload-builder.ts:69-84]
[source: packages/yandex-seo/src/tools/direct-link-metrika-goals.ts:82-108]

### 1.6 WbDailyBudget sub-object

| Field | Type | Notes |
|---|---|---|
| `DailyBudget` | object | `{ Amount: int, Mode: "STANDARD"\|"DISTRIBUTED" }` |

`Amount` is in **micros** (1 RUB = 1 000 000 micros). Minimum 100 RUB = 100 000 000 micros.
[source: packages/yandex-seo/src/tools/direct-create-campaign.ts:5]
[source: packages/yandex-seo/src/lib/payload-builder.ts:65]

### 1.7 TextCampaign.Settings option enum

| Option | Valid values | Meaning |
|---|---|---|
| `ADD_METRICA_TAG` | `YES\|NO` | auto-append Metrika click tag |
| `REQUIRE_SERVICED_BY_DIRECT` | `YES\|NO` | Direct-exclusive serving |
| `CAMPAIGN_EXACT_PHRASE_MATCHING_ENABLED` | `YES\|NO` | strict phrase match |
| `ENABLE_SITE_MONITORING` | `YES\|NO` | pause on site outage |

[source: vendor/yandex-direct-docs-snapshot/docs/campaigns/site-monitoring.md:1]
[source: packages/yandex-seo/src/tools/direct-create-campaign.ts:85]

---

## 2. AdGroup

### 2.1 AdGroup.Type enum

| Type | Valid in Campaign.Type | Notes |
|---|---|---|
| `TEXT_AD_GROUP` | `TEXT_CAMPAIGN`, `UNIFIED_PERFORMANCE_CAMPAIGN` | default; used in our code |
| `MOBILE_APP_AD_GROUP` | `MOBILE_APP_CAMPAIGN`, `UNIFIED_PERFORMANCE_CAMPAIGN` | not implemented |
| `DYNAMIC_TEXT_AD_GROUP` | `DYNAMIC_TEXT_CAMPAIGN` | not implemented |
| `UNIFIED_AD_GROUP` | `UNIFIED_PERFORMANCE_CAMPAIGN` | required for `RESPONSIVE_AD` |
| `SMART_AD_GROUP` | `SMART_CAMPAIGN` | not implemented |
| `CPM_BANNER_AD_GROUP` | `CPM_BANNER_CAMPAIGN` | not implemented |
| `CPM_VIDEO_AD_GROUP` | `CPM_VIDEO_CAMPAIGN` | not implemented |

[source: packages/yandex-seo/src/tools/direct-create-adgroup.ts:9-13]

### 2.2 AdGroup common fields

| API field | Type | Required | Notes |
|---|---|---|---|
| `Name` | string | yes | max 255 chars |
| `CampaignId` | int | yes | parent campaign |
| `RegionIds` | array\<int\> | yes | **set here, NOT on Campaign** — quirk 1 |
| `NegativeKeywords` | `{ Items: string[] }` | no | group-level minus-phrases |
| `NegativeKeywordSharedSetIds` | `{ Items: int[] }` | no | shared library refs |
| `TrackingParams` | string | no | group-level UTM override |
| `Tags` | `{ Items: string[] }` | no | group tags |
| `BidModifiers` | array | no | gender/age/device/region adjustments |
| `AutoTargetingCategories` | object | no | see section 7 |

[source: packages/yandex-seo/src/tools/direct-create-adgroup.ts:23-35]
[source: packages/yandex-seo/src/lib/payload-builder.ts:145-162]

### 2.3 AdGroup Region IDs (common values)

| Region name | ID |
|---|---|
| Moscow | 213 |
| Saint-Petersburg | 2 |
| Russia (all) | 225 |
| Yekaterinburg | 54 |
| Novosibirsk | 65 |
| Kazan | 43 |
| Nizhny Novgorod | 47 |

[source: vendor/yandex-direct-docs-snapshot/docs/efficiency/geotargeting.md:1]

---

## 3. Ad polymorphism

### 3.1 Ad.Type matrix

The `Ad` object is polymorphic: exactly one sub-object block is set alongside
`AdGroupId`, named to match the Type enum token (drop underscores, TitleCase).

| Ad.Type | Sub-object key | Compatible AdGroup.Type | ohmy-seo status |
|---|---|---|---|
| `TEXT_AD` | `TextAd` | `TEXT_AD_GROUP` | ✅ `direct-create-ad-tgo.ts` |
| `TEXT_IMAGE_AD` | `TextImageAd` | `TEXT_AD_GROUP`, `UNIFIED_AD_GROUP` | ✅ `direct-create-ad-rsya.ts`, `direct-create-ad-unified.ts` |
| `RESPONSIVE_AD` | `ResponsiveAd` | `UNIFIED_AD_GROUP` ONLY | ❌ not implemented — critical gap for "комбинированное" |
| `DYNAMIC_TEXT_AD` | `DynamicTextAd` | `DYNAMIC_TEXT_AD_GROUP` | ❌ not implemented |
| `MOBILE_APP_AD` | `MobileAppAd` | `MOBILE_APP_AD_GROUP` | ❌ not implemented |
| `TEXT_AD_BUILDER_AD` | `TextAdBuilderAd` | `TEXT_AD_GROUP`, `UNIFIED_AD_GROUP` | ❌ not implemented |
| `IMAGE_AD` | `ImageAd` | `TEXT_AD_GROUP` | ❌ not implemented |
| `CPC_VIDEO_AD` | `CpcVideoAdBuilderAd` | `TEXT_AD_GROUP`, `MOBILE_APP_AD_GROUP` | ❌ not implemented |
| `CPM_BANNER_AD` | `CpmBannerAd` | `CPM_BANNER_AD_GROUP` | ❌ not implemented |
| `CPM_VIDEO_AD` | `CpmVideoAdBuilderAd` | `CPM_VIDEO_AD_GROUP` | ❌ not implemented |
| `SMART_AD` | `SmartAdBuilderAd` | `SMART_AD_GROUP` | ❌ not implemented |
| `SHOPPING_AD` | `ShoppingAd` | `UNIFIED_AD_GROUP` | ❌ not implemented |
| `LISTING_AD` | `ListingAd` | `UNIFIED_AD_GROUP` | ❌ not implemented |

[source: packages/yandex-seo/src/tools/direct-create-ad-tgo.ts:21-49]
[source: packages/yandex-seo/src/tools/direct-create-ad-rsya.ts:20-43]
[source: packages/yandex-seo/src/tools/direct-create-ad-unified.ts:23-54]

### 3.2 TextAd fields

Used for search-network text ads (`TEXT_AD_GROUP` in `TEXT_CAMPAIGN`).

| API field | Type | Limit | Required | Notes |
|---|---|---|---|---|
| `Title` | string | 56 chars incl. punctuation | yes | main headline |
| `Title2` | string | 30 chars | no | secondary headline |
| `Text` | string | 81 chars incl. punctuation | yes | ad body |
| `Href` | string | — | yes | destination URL |
| `DisplayUrlPath` | string | 20 chars | no | display path after domain |
| `Mobile` | `"YES"\|"NO"` | — | no | default `"NO"` for search TGO |
| `SitelinksSetId` | int | — | no | links to a SitelinksSet entity |
| `VCardId` | int | — | no | business contact card |
| `AdExtensions` | `{ Items: int[] }` | — | no | callout extension IDs |
| `AdImageHash` | string | — | no | image from AdImages library |
| `VideoExtension` | `{ CreativeId: int }` | — | no | video creative |
| `TurboPageId` | int | — | no | Turbo-page ID (not in our code) |
| `BusinessId` | int | — | no | Yandex Business ID (not in our code) |

[source: packages/yandex-seo/src/tools/direct-create-ad-tgo.ts:21-49]
[source: packages/yandex-seo/src/lib/payload-builder.ts:201-234]

### 3.3 TextImageAd fields

Used for RSY A network ads (`TEXT_IMAGE_AD`). Requires an uploaded image.

| API field | Type | Required | Notes |
|---|---|---|---|
| `AdImageHash` | string | yes | from `AdImages.add` response |
| `Title` | string | yes | 56 chars |
| `Title2` | string | no | 30 chars |
| `Text` | string | yes | 81 chars |
| `Href` | string | yes | destination URL |
| `DisplayUrlPath` | string | no | 20 chars |
| `SitelinksSetId` | int | no | |
| `VCardId` | int | no | |
| `AdExtensions` | `{ Items: int[] }` | no | |
| `VideoExtension` | `{ CreativeId: int }` | no | video overlay |

**Note:** `direct-create-ad-unified.ts` currently sends `TextImageAd`, NOT
`ResponsiveAd`. It is mislabeled as "unified" in the tool name. True
`RESPONSIVE_AD` (комбинированное объявление) is absent from our codebase.

[source: packages/yandex-seo/src/tools/direct-create-ad-rsya.ts:20-43]
[source: packages/yandex-seo/src/tools/direct-create-ad-unified.ts:23-54]
[source: packages/yandex-seo/src/lib/payload-builder.ts:246-276]

### 3.4 ResponsiveAd fields (critical gap — Phase 3.5.D target)

`ResponsiveAd` is the true "комбинированное объявление" targeting
`UNIFIED_AD_GROUP` in `UNIFIED_PERFORMANCE_CAMPAIGN`. It accepts arrays of
assets; Yandex assembles combinations automatically.

| API field | Type | Cardinality | Notes |
|---|---|---|---|
| `Titles` | `{ Items: string[] }` | 1–5 | each ≤ 56 chars |
| `Title2s` | `{ Items: string[] }` | 0–5 | each ≤ 30 chars |
| `Texts` | `{ Items: string[] }` | 1–5 | each ≤ 81 chars |
| `Hrefs` | `{ Items: string[] }` | 1–5 | destination URLs |
| `ImageHashes` | `{ Items: string[] }` | 0–5 | from AdImages library |
| `VideoHashes` | `{ Items: string[] }` | 0–2 | video hashes |
| `SitelinksSetId` | int | 0–1 | |
| `AdExtensions` | `{ Items: int[] }` | 0–n | callout IDs |
| `BusinessId` | int | no | Yandex Business |
| `TurboPageId` | int | no | Turbo page |

[source: vendor/yandex-direct-docs-snapshot/docs/campaigns/campaign-settings.md:11]
[source: vendor/yandex-direct-docs-snapshot/docs/glossary.md:89]

verify by: POST `/json/v5/ads` with `{ ResponsiveAd: {...} }` in sandbox.

### 3.5 DynamicTextAd fields (brief)

Targets `DYNAMIC_TEXT_AD_GROUP` in `DYNAMIC_TEXT_CAMPAIGN`. No headlines —
they are generated from the landing page.

| API field | Type | Notes |
|---|---|---|
| `Text` | string | 81 chars; only required field |
| `Href` | string | optional override; otherwise from feed/page |
| `SitelinksSetId` | int | optional |
| `VCardId` | int | optional |
| `AdExtensions` | `{ Items: int[] }` | optional |

[source: vendor/yandex-direct-docs-snapshot/docs/campaigns/campaign-settings.md:1]

### 3.6 MobileAppAd fields (brief)

| API field | Type | Notes |
|---|---|---|
| `Title` | string | 33 chars (mobile limit) |
| `Text` | string | 75 chars |
| `TrackingUrl` | string | AppsFlyer / Adjust deep link |
| `Action` | string | `DOWNLOAD\|GET\|INSTALL\|MORE\|OPEN\|PLAY\|UPDATE\|BOOK\|BUY\|GOTO\|CONTACT\|SUBSCRIBE\|WATCH` |
| `AdImageHash` | string | required image |
| `AgeLabel` | string | `AGE_0\|AGE_6\|AGE_12\|AGE_16\|AGE_18` |

[source: vendor/yandex-direct-docs-snapshot/docs/campaigns/campaign-settings.md:1]

### 3.7 ImageAd fields (brief)

Full-image banner ad for `TEXT_AD_GROUP`.

| API field | Type | Notes |
|---|---|---|
| `AdImageHash` | string | required; specific dimension requirements apply |
| `Href` | string | destination URL |
| `TrackingPixel` | string | impression tracking pixel |

[source: vendor/yandex-direct-docs-snapshot/docs/efficiency/images.md:14]

---

## 4. Keywords + NegativeKeywords

### 4.1 Keyword entity fields

| API field | Type | Required | Notes |
|---|---|---|---|
| `Keyword` | string | yes | the keyword text; max 4096 chars incl. operators; max 7 words |
| `AdGroupId` | int | yes | parent group |
| `Bid` | int | no | CPC in micros (manual strategy only) |
| `ContextBid` | int | no | network bid in micros |
| `ServingStatus` | string | read-only | `ELIGIBLE\|RARELY_SERVED\|LOW_QUALITY\|INVALID_KEYWORD\|SUSPENDED` |
| `AutotargetingExclusion` | `{ Items: string[] }` | no | autotargeting category exclusion overrides per keyword |
| `Id` | int | read-only | assigned by API |
| `CampaignId` | int | read-only | |

[source: vendor/yandex-direct-docs-snapshot/docs/keywords/keywords.md:44-59]
[source: packages/yandex-seo/src/lib/payload-builder.ts:174-189]

### 4.2 Keyword text operators

| Operator | Symbol | Effect |
|---|---|---|
| Exact form | `!` | fixes word form; `!купить` won't match `купите` |
| Fixed stop word | `+` | `+не купить` — stops word exclusion |
| Phrase match | `""` | exact phrase with no insertions |
| Group | `()` | `(купить\|заказать) туры` |
| Minus | `-` | inline negative: `туры -дешево` |
| Broad match | `~` | semantic match expansion |

[source: vendor/yandex-direct-docs-snapshot/docs/keywords/symbols-and-operators.md:1]

### 4.3 NegativeKeywords placement levels

| Level | API location | Scope |
|---|---|---|
| keyword-level | `Keyword.text` inline via `-word` | this keyword only |
| AdGroup-level | `AdGroup.NegativeKeywords.Items` | all ads in group |
| Campaign-level | `TextCampaign.NegativeKeywords.Items` (via update) | all groups |
| Shared library | `NegativeKeywordSharedSet` entity; `NegativeKeywordSharedSetIds` | reusable across campaigns |

[source: vendor/yandex-direct-docs-snapshot/docs/keywords/negative-keywords.md:1]
[source: packages/yandex-seo/src/tools/direct-create-adgroup.ts:14-18]

### 4.4 NegativeKeywordSharedSet entity (separate API resource)

Endpoint: `POST /json/v5/negativekeywordsharedsets`

| API field | Type | Notes |
|---|---|---|
| `Name` | string | library name |
| `NegativeKeywords` | `{ Items: string[] }` | minus-phrase list |
| `Id` | int | read-only |

[source: vendor/yandex-direct-docs-snapshot/docs/keywords/negative-keywords-library.md:1]

---

## 5. AdExtensions — Sitelinks, Callouts, VCards, AdImages

### 5.1 SitelinksSet entity

Endpoint: `POST /json/v5/sitelinkssets`

| API field | Type | Required | Limit | Notes |
|---|---|---|---|---|
| `Sitelinks` | `{ Items: Sitelink[] }` | yes | 1–8 per set | |
| `Sitelink.Title` | string | yes | 30 chars | link text |
| `Sitelink.Description1` | string | no | 60 chars | shown in exclusive placement |
| `Sitelink.Description2` | string | no | 60 chars | second description line |
| `Sitelink.Href` | string | no | — | overrides ad URL; same domain required |
| `Sitelink.TurboPageId` | int | no | — | Turbo page target |
| `Id` | int | read-only | — | assign via `SitelinksSetId` on the ad |

[source: vendor/yandex-direct-docs-snapshot/docs/efficiency/quick-links.md:16-52]
[source: packages/yandex-seo/src/tools/direct-create-ad-tgo.ts:12]

Sitelinks show on both Search and RSY A (РСЯ). Maximum shown depends on
placement format; exclusive format shows all 8 with descriptions.

### 5.2 Callout (Уточнение) entity

Endpoint: `POST /json/v5/adextensions` (type: `CALLOUT`)

| API field | Type | Required | Limit | Notes |
|---|---|---|---|---|
| `Callout.CalloutText` | string | yes | 25 chars | advantage text |
| `Id` | int | read-only | — | reference via `AdExtensions.Items` |

Total callout text per ad ≤ 132 chars (desktop), ≤ 76 chars (mobile).
Callouts cannot be edited after creation — delete and recreate.

[source: vendor/yandex-direct-docs-snapshot/docs/efficiency/callout.md:1-52]
[source: packages/yandex-seo/src/tools/direct-create-ad-tgo.ts:14]

### 5.3 VCard entity

Business contact card. Referenced as `VCardId` on TextAd/TextImageAd.

| API field | Type | Notes |
|---|---|---|
| `CompanyName` | string | |
| `WorkTime` | string | `WORKDAYS,09:00,18:00` format |
| `Phone.CountryCode` | string | e.g. `+7` |
| `Phone.CityCode` | string | e.g. `499` |
| `Phone.PhoneNumber` | string | |
| `Phone.Extension` | string | |
| `Address.Street` | string | |
| `Address.House` | string | |
| `Geo.Lon` | float | longitude |
| `Geo.Lat` | float | latitude |
| `OGRN` | string | Russian company number |
| `Email` | string | |
| `ContactSiteUrl` | string | |
| `Id` | int | read-only |

[source: vendor/yandex-direct-docs-snapshot/docs/efficiency/vcards.md:1-60]

### 5.4 AdImage entity

Endpoint: `POST /json/v5/adimages`

| API field | Type | Required | Notes |
|---|---|---|---|
| `ImageData` | string | yes (or `ImageUrl`) | base64-encoded JPEG or PNG |
| `ImageUrl` | string | yes (or `ImageData`) | public URL alternative |
| `Name` | string | **yes** | unique name **REQUIRED** — quirk 3; omitting causes API rejection |
| `AdImageHash` | string | read-only | returned in AddResults; use as `AdImageHash` on ads |
| `OriginalUrl` | string | read-only | |
| `Subtype` | string | read-only | `REGULAR\|WIDE` |

**Quirk 3:** The `Name` field is mandatory despite not being documented as such
in some early API versions. Our pipeline generates `phase-${Date.now()}-${hex}`.

Size limits: max 10 MB. Dimensions: 450–5000 px per side; 16:9 needs
1080×607 minimum.

[source: vendor/yandex-direct-docs-snapshot/docs/efficiency/images.md:39-59]
[source: packages/yandex-seo/src/tools/direct-upload-image.ts:148-159]
[source: packages/yandex-seo/src/lib/payload-builder.ts:290-307]

### 5.5 PromoExtension (Промоакция) — Phase 3.5.D target

Stored in a shared library. Referenced on campaign or group. Distinct from
AdExtensions — not linked via `AdExtensions.Items`.

| API field | Type | Values | Notes |
|---|---|---|---|
| `PromotionType` | string | `DISCOUNT\|BONUS\|CASHBACK\|GIFT\|FREE\|INSTALLMENT_ZERO_PERCENT` | type of promo |
| `Discount` | int | 1–100 (%) or 1–1 000 000 (currency) | amount; required |
| `DiscountUnit` | string | `PERCENT\|RUB\|EUR\|USD\|BYN\|KZT\|UAH` | unit |
| `Description` | string | 3–45 chars | promo description; required |
| `PromoCode` | string | max 16 chars | optional; user can copy directly |
| `StartDate` | string | `YYYY-MM-DD` | optional |
| `EndDate` | string | `YYYY-MM-DD` | optional; shows countdown timer in RSY A |
| `Href` | string | same domain | optional separate promo URL |
| `Id` | int | read-only | library ID |

Russian type labels:
- `DISCOUNT` = «Скидка»
- `BONUS` = «Выгода»
- `CASHBACK` = «Кешбэк»
- `GIFT` = «Подарок»
- `FREE` = «Бесплатно»
- `INSTALLMENT_ZERO_PERCENT` = «Рассрочка 0%»

[source: vendor/yandex-direct-docs-snapshot/docs/efficiency/promotion.md:28-49]
[source: vendor/yandex-direct-docs-snapshot/docs/campaigns/campaign-settings.md:64-70]

---

## 6. Reports v5 Statistics

### 6.1 Report request structure

Endpoint: `POST /json/v5/reports` (async polling; returns `202` while building)

| Request field | Type | Notes |
|---|---|---|
| `SelectionCriteria` | object | `{ CampaignIds: [], Filter: [...] }` |
| `FieldNames` | string[] | dimension + metric columns |
| `ReportName` | string | unique; Yandex caches by name |
| `ReportType` | string | see enum below |
| `DateRangeType` | string | see enum below |
| `Format` | string | `TSV` (only supported value) |
| `IncludeVAT` | `"YES"\|"NO"` | |
| `IncludeDiscount` | `"YES"\|"NO"` | |
| `Page` | `{ Limit, Offset }` | pagination |

[source: packages/yandex-seo/src/tools/direct-get-stats.ts:58-74]

### 6.2 ReportType enum

| Value | Description |
|---|---|
| `CUSTOM_REPORT` | ad-hoc; any field combination |
| `CAMPAIGN_PERFORMANCE_REPORT` | campaign-level aggregation |
| `AD_PERFORMANCE_REPORT` | per-ad breakdown |
| `AD_GROUP_PERFORMANCE_REPORT` | per-group breakdown |
| `CRITERIA_PERFORMANCE_REPORT` | per-keyword/targeting |
| `SEARCH_QUERY_PERFORMANCE_REPORT` | actual search term report |
| `REACH_AND_FREQUENCY_PERFORMANCE_REPORT` | impression frequency |
| `ACCOUNT_PERFORMANCE_REPORT` | account totals |

[source: packages/yandex-seo/src/tools/direct-get-stats.ts:28]

### 6.3 DateRangeType enum

| Value | Notes |
|---|---|
| `TODAY` | |
| `YESTERDAY` | |
| `LAST_3_DAYS` | |
| `LAST_5_DAYS` | |
| `LAST_7_DAYS` | default in our code |
| `LAST_14_DAYS` | |
| `LAST_30_DAYS` | |
| `LAST_90_DAYS` | |
| `THIS_WEEK_MON_TODAY` | |
| `THIS_MONTH` | |
| `LAST_MONTH` | |
| `ALL_TIME` | |
| `CUSTOM_DATE` | requires `DateFrom` + `DateTo` |

[source: packages/yandex-seo/src/tools/direct-get-stats.ts:7-14]

### 6.4 Common FieldNames (dimension + metric identifiers)

| FieldName | Type | Description |
|---|---|---|
| `Date` | dimension | report date `YYYY-MM-DD` |
| `CampaignId` | dimension | |
| `CampaignName` | dimension | |
| `AdGroupId` | dimension | |
| `AdGroupName` | dimension | |
| `AdId` | dimension | |
| `Keyword` | dimension | matched keyword |
| `Query` | dimension | actual search query (SEARCH_QUERY report) |
| `TargetingCategory` | dimension | autotargeting category |
| `Impressions` | metric | |
| `Clicks` | metric | |
| `Ctr` | metric | |
| `Cost` | metric | in micros |
| `AvgCpc` | metric | average cost per click |
| `Conversions` | metric | Metrika goal completions |
| `ConversionRate` | metric | |
| `CostPerConversion` | metric | |
| `Revenue` | metric | e-commerce revenue |

[source: packages/yandex-seo/src/tools/direct-get-stats.ts:23]

---

## 7. AutoTargeting

### 7.1 AutoTargeting concept

AutoTargeting shows ads without keywords by analyzing ad text and landing page.
Works on Search (query matching) and RSY A (interest-based).

[source: vendor/yandex-direct-docs-snapshot/docs/impression-criteria/autotargeting.md:14]
[source: vendor/yandex-direct-docs-snapshot/docs/glossary.md:39-41]

### 7.2 AutoTargetingCategories.Items structure (API)

Set on the `AdGroup` object (not on the campaign).

```
AdGroup:
  AutoTargetingCategories:
    Items:
      - { Category: TARGET_QUERIES, Value: YES }
      - { Category: NARROW_QUERIES, Value: YES }
      - { Category: BROAD_MATCH, Value: NO }
      - { Category: ALTERNATIVE_QUERIES, Value: NO }
      - { Category: ACCESSORY_QUERIES, Value: NO }
```

[source: vendor/yandex-direct-docs-snapshot/docs/impression-criteria/autotargeting.md:43-74]

### 7.3 AutoTargeting Category enum + Russian labels

| API Category | Russian label | Meaning |
|---|---|---|
| `TARGET_QUERIES` | Целевые запросы | ad directly answers the query |
| `NARROW_QUERIES` | Узкие запросы | user's query is more specific than the ad |
| `BROAD_MATCH` | Широкие запросы | user searches broad category containing the offer |
| `ALTERNATIVE_QUERIES` | Альтернативные запросы | user seeks a substitute for what ad offers |
| `ACCESSORY_QUERIES` | Сопутствующие запросы | related products/services queries |

> Note: NARROW_QUERIES were historically part of TARGET_QUERIES. Campaigns
> created before the split have both enabled automatically.

[source: vendor/yandex-direct-docs-snapshot/docs/impression-criteria/autotargeting.md:43-51]

### 7.4 Brand-mention filter (UNIFIED_AD_GROUP specific)

| Setting | Meaning |
|---|---|
| Own brand queries enabled | show on `купить [brand]`-type queries |
| Competitor brand queries enabled | show on competitor brand queries |
| No brand filter | all queries without brand filtering |

[source: vendor/yandex-direct-docs-snapshot/docs/impression-criteria/autotargeting.md:56-64]

### 7.5 AutoTargeting bid control

In manual strategies:
- Search: explicit bid can be set for autotargeting row
- Auto-bid formula: weighted average of keyword bids × clicks
- Network: bid is always automatic

`AutotargetingSearchBidIsAuto: YES|NO` controls whether the bid is
auto-computed or manually fixed.

[source: vendor/yandex-direct-docs-snapshot/docs/impression-criteria/autotargeting.md:125-156]

### 7.6 AutoTargeting vs Keywords relationship

AutoTargeting runs in **parallel** with keywords at equal priority. Statistics
are tracked separately. Irrelevant queries from autotargeting should be added
to the NegativeKeywords list.

[source: vendor/yandex-direct-docs-snapshot/docs/impression-criteria/autotargeting.md:34-38]

---

## 8. Renames — Tier 1 (mandatory) and Tier 2 (optional)

### 8.1 Tier 1 — Mandatory naming in new Phase 3.5.D YAML schema

All YAML keys for Campaign, AdGroup, and Ad fields MUST use API PascalCase
exactly. This is a hard requirement for YAML ↔ API round-tripping.

| YAML key (new) | API field | Notes |
|---|---|---|
| `Type` | `Type` | campaign, group, and ad type enum |
| `Name` | `Name` | campaign/group name |
| `StartDate` | `StartDate` | `YYYY-MM-DD` |
| `EndDate` | `EndDate` | optional |
| `DailyBudget.Amount` | `DailyBudget.Amount` | micros |
| `DailyBudget.Mode` | `DailyBudget.Mode` | `STANDARD\|DISTRIBUTED` |
| `TextCampaign` | `TextCampaign` | sub-object for TEXT_CAMPAIGN |
| `BiddingStrategy.Search.BiddingStrategyType` | direct match | |
| `BiddingStrategy.Network.BiddingStrategyType` | direct match | |
| `CounterIds.Items` | `CounterIds.Items` | int array |
| `PriorityGoals.Items` | `PriorityGoals.Items` | `[{ GoalId, Value }]` |
| `TrackingParams` | `TrackingParams` | UTM string |
| `RegionIds` | `RegionIds` | int array; on AdGroup |
| `NegativeKeywords.Items` | `NegativeKeywords.Items` | string array |
| `AdGroupId` | `AdGroupId` | on Keyword and Ad |
| `CampaignId` | `CampaignId` | on AdGroup |
| `AutoTargetingCategories.Items` | direct match | |
| `SitelinksSetId` | `SitelinksSetId` | on Ad sub-objects |
| `AdExtensions.Items` | `AdExtensions.Items` | callout IDs |

### 8.2 Tier 2 — Existing tool snake_case parameters (optional renames)

These are MCP tool input parameters (not API fields). Rename is optional but
recommended for consistency. Renaming is a **breaking change** for tool callers.

| Current code param | API equivalent | File:Line | Effort | Risk |
|---|---|---|---|---|
| `ad_group_id` | `AdGroupId` | `direct-create-ad-tgo.ts:6` | trivial | breaking — all callers must update |
| `ad_group_id` | `AdGroupId` | `direct-create-ad-rsya.ts:6` | trivial | breaking |
| `ad_group_id` | `AdGroupId` | `direct-create-ad-unified.ts:6` | trivial | breaking |
| `campaign_id` | `CampaignId` | `direct-create-adgroup.ts:6` | trivial | breaking |
| `daily_budget_rub` | custom helper (× 1 000 000 → `Amount`) | `direct-create-campaign.ts:10` | small | keep as helper; expose `DailyBudget.Amount` in YAML schema |
| `start_date` | `StartDate` | `direct-create-campaign.ts:12` | trivial | safe if alias kept |
| `counter_ids` | `CounterIds.Items` | `direct-create-campaign.ts:21` | trivial | breaking |
| `region_ids` | `RegionIds` | `direct-create-campaign.ts:11` | trivial | breaking |
| `ad_image_hash` | `AdImageHash` | `direct-create-ad-rsya.ts:7` | trivial | breaking |
| `sitelinks_set_id` | `SitelinksSetId` | `direct-create-ad-tgo.ts:12` | trivial | breaking |
| `vcard_id` | `VCardId` | `direct-create-ad-tgo.ts:13` | trivial | breaking |
| `ad_extensions` | `AdExtensions.Items` | `direct-create-ad-tgo.ts:14` | trivial | breaking |
| `campaign_ids` | `SelectionCriteria.Ids` | `direct-pause-campaigns.ts:7` | small | internal only |
| `goal_ids` | `GoalId` (per item) | `direct-link-metrika-goals.ts:8` | small | breaking |
| `strategy_type` | `BiddingStrategyType` | `direct-link-metrika-goals.ts:10` | small | breaking |

**Recommendation:** Do NOT rename Tier 2 in Phase 3.5.D. Introduce new YAML
upload pipeline with correct Tier 1 names. Retire old params in Phase 4.

---

## 9. Gaps — In the Direct API but not in our code

The following API features are absent from ohmy-seo tooling as of Phase 3.5.C.

### 9.1 Ad types not implemented

1. **ResponsiveAd** — true "комбинированное объявление" for `UNIFIED_PERFORMANCE_CAMPAIGN`. Critical for Phase 3.5.D.
2. **DynamicTextAd** — auto-generated titles from landing pages; needs `DYNAMIC_TEXT_CAMPAIGN`.
3. **ShoppingAd / ListingAd** — catalog feed ads; need product feeds (`Feeds` API).
4. **MobileAppAd** — app promotion; needs `TrackingUrl` and `Action` enum.
5. **TextAdBuilderAd** — Creative Studio builder ads.
6. **ImageAd** — full-image banner for TEXT_AD_GROUP.
7. **CpcVideoAdBuilderAd** — CPC video ads.
8. **CpmBannerAd / CpmVideoAdBuilderAd** — CPM format; different campaign type.
9. **SmartAdBuilderAd** — smart banners; need `SMART_CAMPAIGN`.

[source: packages/yandex-seo/src/tools/direct-create-ad-unified.ts:1 — naming mismatch]

### 9.2 Campaign types not implemented

- `UNIFIED_PERFORMANCE_CAMPAIGN` (needed for `RESPONSIVE_AD`)
- `DYNAMIC_TEXT_CAMPAIGN`
- `SMART_CAMPAIGN`
- `CPM_BANNER_CAMPAIGN`
- `MOBILE_APP_CAMPAIGN`

[source: packages/yandex-seo/src/tools/direct-create-campaign.ts:8]

### 9.3 Ad extension types not implemented

- **PromoExtension** (Промоакция) — Phase 3.5.D target; stored in library API
- **VCard creation** — VCardId referenced but no `direct-create-vcard.ts` tool
- **Callout creation** — `AdExtensions.Items` referenced but no tool to create callouts

### 9.4 Audience and bidding features not implemented

- **BidModifiers** — gender, age, device, region, retargeting segment adjustments
- **RetargetingLists** — audience segments for RSY A retargeting
- **AudienceTargets** — interest-based and lookalike audiences
- **DynamicTextAdTargets** — page feed targets for dynamic campaigns

### 9.5 Structural features not implemented

- **Feeds** (товарные фиды) — product catalog uploads for smart/shopping ads
- **TurboPageId** on TextAd/TextImageAd — Turbo page targets
- **BusinessId** on TextAd — Yandex Business integration
- **AgencyClients** — MCC client management API
- **Recommendations** — automated optimization suggestions API
- **BidModifiers** — demographic and device bid adjustment

[source: vendor/yandex-direct-docs-snapshot/docs/impression-criteria/retargeting-lists.md:1]

---

## 10. Implementation Guidance for Phase 3.5.D YAML Schema

### 10.1 Schema version and top-level structure

```yaml
schema_version: 2

campaign:
  Type: TEXT_CAMPAIGN
  Name: "example_search_2026-05"
  StartDate: "2026-05-25"
  TextCampaign:
    BiddingStrategy:
      Search:
        BiddingStrategyType: HIGHEST_POSITION
      Network:
        BiddingStrategyType: SERVING_OFF
    CounterIds:
      Items: [54918634]
    PriorityGoals:
      Items:
        - { GoalId: 254644847, Value: 100 }
    TrackingParams: "utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}&utm_term={keyword}"
    Settings:
      Items:
        - { Option: ADD_METRICA_TAG, Value: YES }

sitelinks_set:
  Sitelinks:
    Items:
      - Title: "Расписание"
        Description1: "Все курсы и группы"
        Href: "https://example.com/schedule"
      - Title: "Цены"
        Description1: "Стоимость обучения"
        Href: "https://example.com/prices"

promo_extension:
  PromotionType: DISCOUNT
  Discount: 20
  DiscountUnit: PERCENT
  Description: "Скидка на первый урок"
  EndDate: "2026-06-30"

groups:
  - Name: "1_stobalnyy-repetitor"
    Type: TEXT_AD_GROUP
    RegionIds: [213]
    NegativeKeywords:
      Items: ["бесплатно", "скачать"]
    AutoTargetingCategories:
      Items:
        - { Category: TARGET_QUERIES, Value: YES }
        - { Category: NARROW_QUERIES, Value: YES }
        - { Category: BROAD_MATCH, Value: NO }
        - { Category: ALTERNATIVE_QUERIES, Value: NO }
        - { Category: ACCESSORY_QUERIES, Value: NO }
    keywords:
      - Keyword: "стобальный репетитор"
      - Keyword: "подготовка к ЕГЭ 100 баллов"
    ads:
      - variant_id: A
        Type: TEXT_AD
        TextAd:
          Title: "100 баллов ЕГЭ — Гарантия"
          Title2: "Онлайн репетитор"
          Text: "Занятия с преподавателями МГУ. Готовимся к ЕГЭ с нуля."
          Href: "https://example.com/ege-100"
          DisplayUrlPath: "ege-100"
          SitelinksSetId: "${sitelinks_set.Id}"
      - variant_id: B
        Type: TEXT_IMAGE_AD
        TextImageAd:
          AdImageHash: "${image.ege_hero.AdImageHash}"
          Title: "100 баллов ЕГЭ"
          Text: "Онлайн подготовка к ЕГЭ с гарантией результата"
          Href: "https://example.com/ege-100"
          SitelinksSetId: "${sitelinks_set.Id}"
```

[source: packages/yandex-seo/src/lib/upload-pipeline.ts:36-80]
[source: packages/yandex-seo/src/lib/payload-builder.ts:56-132]

### 10.2 YAML for UNIFIED_PERFORMANCE_CAMPAIGN with ResponsiveAd

```yaml
schema_version: 2

campaign:
  Type: UNIFIED_PERFORMANCE_CAMPAIGN
  Name: "example_unified_2026-05"
  StartDate: "2026-05-25"
  UnifiedPerformanceCampaign:
    BiddingStrategy:
      Search:
        BiddingStrategyType: HIGHEST_POSITION
      Network:
        BiddingStrategyType: WB_MAXIMUM_CLICKS
        WbMaximumClicks:
          WeeklySpendingLimit: 700000000
    CounterIds:
      Items: [54918634]
    TrackingParams: "utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}"

groups:
  - Name: "1_stobalnyy-repetitor-unified"
    Type: UNIFIED_AD_GROUP
    RegionIds: [213]
    AutoTargetingCategories:
      Items:
        - { Category: TARGET_QUERIES, Value: YES }
        - { Category: NARROW_QUERIES, Value: YES }
    ads:
      - variant_id: responsive_A
        Type: RESPONSIVE_AD
        ResponsiveAd:
          Titles:
            Items:
              - "100 баллов ЕГЭ — Гарантия"
              - "Стобальный репетитор онлайн"
              - "Подготовка к ЕГЭ за год"
          Title2s:
            Items:
              - "Занятия с преподавателями МГУ"
              - "Результат или деньги назад"
          Texts:
            Items:
              - "Готовимся к ЕГЭ с нуля до 100 баллов. Онлайн."
              - "Репетиторы с опытом 10+ лет. Первый урок бесплатно."
          Hrefs:
            Items:
              - "https://example.com/ege-100"
          ImageHashes:
            Items:
              - "${image.ege_hero.AdImageHash}"
```

[source: vendor/yandex-direct-docs-snapshot/docs/glossary.md:87-89]

### 10.3 Group.Type ↔ Ad.Type validation matrix

The pipeline MUST validate this matrix before uploading. Invalid combinations
cause API rejection.

| Group.Type | Allowed Ad.Type values |
|---|---|
| `TEXT_AD_GROUP` | `TEXT_AD`, `TEXT_IMAGE_AD`, `IMAGE_AD`, `CPC_VIDEO_AD`, `TEXT_AD_BUILDER_AD` |
| `UNIFIED_AD_GROUP` | `TEXT_IMAGE_AD`, `RESPONSIVE_AD`, `SHOPPING_AD`, `LISTING_AD`, `TEXT_AD_BUILDER_AD` |
| `DYNAMIC_TEXT_AD_GROUP` | `DYNAMIC_TEXT_AD` |
| `MOBILE_APP_AD_GROUP` | `MOBILE_APP_AD`, `CPC_VIDEO_AD` |
| `SMART_AD_GROUP` | `SMART_AD` |
| `CPM_BANNER_AD_GROUP` | `CPM_BANNER_AD` |
| `CPM_VIDEO_AD_GROUP` | `CPM_VIDEO_AD` |

[source: packages/yandex-seo/src/tools/direct-create-adgroup.ts:9-13]
[source: vendor/yandex-direct-docs-snapshot/docs/campaigns/campaign-settings.md:1]

### 10.4 Reference resolution (`${...}` syntax)

YAML files may reference entities uploaded in prior steps:

| Reference pattern | Resolves to | Upload order |
|---|---|---|
| `${sitelinks_set.Id}` | `SitelinksSetId` from SitelinksSet.add response | Step 0: before groups |
| `${promo_extension.Id}` | PromoExtension library ID | Step 0: before campaign |
| `${image.<name>.AdImageHash}` | Hash from AdImages.add | Step 0: before ads |
| `${campaign.Id}` | Campaign ID from Campaigns.add | Step 1 |
| `${group.<name>.Id}` | AdGroup ID | Step 2 |

Resolution happens at upload time in the pipeline. Unknown references abort
the run with a clear error message.

[source: packages/yandex-seo/src/lib/upload-pipeline.ts:1-30]

### 10.5 UTM / TrackingParams macros

Yandex Direct supports dynamic parameter substitution in `TrackingParams` and
`Href` values. These are resolved by Direct at serve time, not by our pipeline.

| Macro | Value at serve time |
|---|---|
| `{campaign_id}` | numeric campaign ID |
| `{ad_id}` | numeric ad ID |
| `{keyword}` | matched keyword text |
| `{source}` | placement domain |
| `{source_type}` | `search\|context` |
| `{position}` | position number |
| `{position_type}` | `premium\|other\|none` |
| `{region_name}` | user's region |
| `{region_id}` | numeric region ID |
| `{addphrases}` | `yes` if from autotargeting |
| `{phrase_id}` | keyword ID |

[source: vendor/yandex-direct-docs-snapshot/docs/campaigns/campaign-settings.md:60-62]

### 10.6 Attribute inheritance hierarchy

Extensions (sitelinks, callouts, promo) are inherited top-down:
Campaign → AdGroup → Ad. More specific level wins.

| Level | Where set | API object |
|---|---|---|
| Campaign | default for all groups | `TextCampaign` or `UnifiedPerformanceCampaign` |
| AdGroup | overrides campaign | `AdGroup` fields |
| Ad | overrides group | Ad sub-object fields |

[source: vendor/yandex-direct-docs-snapshot/docs/efficiency/quick-links.md:40-44]
[source: vendor/yandex-direct-docs-snapshot/docs/efficiency/callout.md:34-38]
[source: vendor/yandex-direct-docs-snapshot/docs/efficiency/promotion.md:60-68]

---

## 11. Known Quirks Discovered in Live Smoke Tests

All four quirks are documented in `payload-builder.ts` header comments.

| Quirk # | Description | Affected field | File:Line |
|---|---|---|---|
| 1 | `RegionIds` lives on AdGroup, NOT Campaign | `AdGroup.RegionIds` | `payload-builder.ts:1-8` |
| 2 | `WB_DAILY_BUDGET` is invalid for Search side; use `HIGHEST_POSITION` or `AVERAGE_CPC` | `BiddingStrategy.Search.BiddingStrategyType` | `payload-builder.ts:69-84` |
| 3 | `AdImages.add` requires `Name` field; omitting causes rejection | `AdImage.Name` | `payload-builder.ts:285-307` |
| 4 | `StartDate` must be Moscow time (UTC+3); UTC date can cause past-date error near midnight | `Campaign.StartDate` | `payload-builder.ts:21-26` |

[source: packages/yandex-seo/src/lib/payload-builder.ts:1-14]

---

## 12. Summary — fields_mapped / misalignments / gaps count

| Metric | Count |
|---|---|
| Total API fields mapped in this document | 94 |
| Current misalignments found (snake_case tool params vs PascalCase API) | 15 |
| Optional renames recommended (Tier 2) | 15 |
| Ad types not implemented (gaps) | 9 |
| Campaign types not implemented (gaps) | 5 |
| Extension types not implemented (gaps) | 3 |
| Audience/bidding features not implemented (gaps) | 4 |
| Structural API features not implemented (gaps) | 6 |
| Total gap items | 27 |
| Blocked by missing vendor docs | none — all researched from snapshot |

---

*Document authored: 2026-05-22. Sources: Yandex Direct API v5 vendor snapshot
(509 articles), ohmy-seo codebase Phase 3.5.A–C, live smoke test findings.*
