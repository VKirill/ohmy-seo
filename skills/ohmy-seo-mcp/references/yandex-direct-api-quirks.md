# Yandex.Direct API quirks — verified-live gotchas (combinatorial ЕПК era)

Quirks that bite every combinatorial upload. Confirmed live against `<client_login>` cabinets (USD and RUB) in 2026. Everything here assumes the **combinatorial-only** model: ЕПК (`UNIFIED_CAMPAIGN`) + `RESPONSIVE_AD` on `/json/v501/`. Classic `TextAd`/`TextImageAd` are retired — don't build them.

## 1. Combinatorial ads only serve on search inside a ЕПК (v501)

A `RESPONSIVE_AD` (combinatorial: 1–7 `Titles`, 1–3 `Texts`) shows **on search only inside a `UNIFIED_CAMPAIGN`** created on `/json/v501/`. Posting a `ResponsiveAd` into a classic `TEXT_CAMPAIGN` is **accepted** (returns an Id) but the ad has nowhere to serve on search — the returned Id fools you. Posting to `/json/v5/ads` returns error **3500** ("use v501"). Campaign **type is immutable** — you can never convert a `TEXT_CAMPAIGN` into ЕПК; create a new one.

Create-campaign body: the `UnifiedCampaign` structure (not a `Type` field) makes it ЕПК; `DailyBudget` sits at campaign level; `Search` must be an active strategy (not `SERVING_OFF`):

```json
{"method":"add","params":{"Campaigns":[{
  "Name":"epk-...","StartDate":"2026-07-08",
  "DailyBudget":{"Amount":10000000,"Mode":"STANDARD"},
  "UnifiedCampaign":{"BiddingStrategy":{
    "Search":{"BiddingStrategyType":"HIGHEST_POSITION"},
    "Network":{"BiddingStrategyType":"SERVING_OFF"}}}}]}}
```

Reads back as `Type: "UNIFIED_CAMPAIGN"`. (Note: the code helper `buildUnifiedPerformanceCampaignPayload` uses the WRONG names `UnifiedPerformanceCampaign`/`UNIFIED_PERFORMANCE_CAMPAIGN` — the API wants `UnifiedCampaign`/`UNIFIED_CAMPAIGN`.)

## 2. `Type` is forbidden in `AdGroups.add` on v501

Sending `Type: "UNIFIED_AD_GROUP"` (or any `Type`) in the group body returns error **8000** «Элемент массива AdGroups содержит неизвестный параметр Type». The group inherits its type from the ЕПК campaign — omit `Type` entirely. `RegionIds` is still required (see #4).

```json
{"method":"add","params":{"AdGroups":[{"Name":"cluster","CampaignId":<id>,"RegionIds":[1]}]}}
```

## 3. Ad Ids exceed 2^53 — never round-trip them through a JS Number

Combinatorial **ad** Ids look like `1914841739704982433` — larger than `Number.MAX_SAFE_INTEGER`. `JSON.parse` / `response.json()` silently rounds them, so a later `delete`/`moderate` by that Id returns **8800** «Объект не найден» (or hits the wrong object). Read ad responses as **raw text** and extract the Id with a regex, pass it back verbatim:

```js
const body = await resp.text();                  // NOT resp.json()
const adId = (body.match(/"Id":(\d+)/) || [])[1]; // exact digits as string
// delete: body string with the exact digits, no Number()
```

Campaign Ids (~9-digit) and group Ids (~10-digit) are under 2^53 and safe as numbers; only ad Ids need this.

## 4. RegionIds lives on AdGroup, not Campaign

The API ignores `RegionIds` on `Campaigns.add/update` and **requires** it on `AdGroups.add`. Use `buildAdGroupPayload({ region_ids: [...] })`. Standard IDs: `1` Московская область, `213` Москва, `2` СПб, `10174` Ленинградская обл., `0`/empty вся Россия (avoid unless asked).

## 5. Money is micros and currency-aware — never hardcode RUB

All amounts are integer **micros** (value × 1 000 000), same multiplier for every currency. The account currency is fixed (e.g. **USD**; read via `Clients.get` → `Currency`). Minimums come from `Dictionaries.get {Currencies}` — do not hardcode a ruble floor. Verified USD floors: `MinimumDailyBudget` 10000000 ($10/day), `MinimumBid` 10000 ($0.01), `MinimumWeeklySpendLimit` 10000000 ($10/wk), `MinimumAverageCPC` 30000 ($0.03), `MaximumBid` 700000000 ($700). `DailyBudget` at campaign level needs no `Currency` sub-field (follows the account). (Code helper `buildUnifiedPerformanceCampaignPayload` hardcodes `Currency:"RUB"` — a bug for USD accounts.)

## 6. Text >81 chars fails the whole ad (error 5001)

Each `Texts[]` entry must be ≤81 chars (each word ≤23); each `Titles[]` entry ≤56 (each word ≤22). An over-length text returns **5001** «Превышена допустимая длина ... поле Text не должно превышать 81 символ» and the ad is rejected. Validate every title/text with a separate QA script **before** the upload — this is the single most common silent killer (it looked like "462 ads failed" in one run that was really all length overflows).

## 7. Combinatorial ad cap: max 3 non-archived ads per group

One `RESPONSIVE_AD` already holds the **whole** pool (up to 7 titles × 3 texts — Yandex assembles the combinations internally). So one combinatorial ad per group is normal. The group limit is **3 non-archived `RESPONSIVE_AD`** (10 including archived); a 4th returns error **7001** «Достигнуто максимальное количество комбинаторных объявлений в группе - 3». Use 2–3 only for genuinely different creative concepts — **do not** explode a 7×3 pool into 21 separate ads (that's the retired single-title model and it trips this cap immediately).

## 8. `Ads.get` FieldNames enum is restricted — `Title`/`Text` are not valid

`Ads.get` `FieldNames` accepts only: `AdCategories, AgeLabel, AdGroupId, CampaignId, Id, State, Status, StatusClarification, Type, Subtype`. `Title`/`Text` there → error **8000**. To read creative text use the `ResponsiveAdFieldNames` sub-selector (e.g. `["Titles","Texts","Href","AdImageHashes"]`), not the top-level `FieldNames`. For per-group dedup, compare the desired pool against existing ads (or a local record) rather than expecting title/text in the flat field list.

## 9. `AcceptResult` is undefined on successful responses

Successful `AdGroups.add`/`Ads.add` returns `{"AddResults":[{"Id":…,"Errors":[]}]}` — no `AcceptResult` (it only appears when moderation is triggered, which we don't). Don't `JSON.stringify(accept).slice(...)` — it crashes with `Cannot read properties of undefined`. Print `Id` and `Errors.length` only, and always read **per-ad** `AddResults[].Errors` (a "0 added" run hides its real reason there — 5001/7001/etc — not in the top-level `error`).

## 10. `/clients` is unreliable for agency accounts

`<account>` returns `{"Clients":[]}` even though it manages `<client_login>`, etc. Don't trust `/clients` to enumerate cabinets — pass the `Client-Login` header explicitly and trust the human-provided `client_login`. (`Clients.get` IS reliable for reading the current cabinet's `Currency` once you pass its `Client-Login`.)

## 11. Duplicate group/campaign names are allowed (idempotency gotcha)

Yandex does **not** enforce unique names. Retrying a non-idempotent upload creates 3–5 duplicate campaigns / groups. Always compare by **`Id`**, pulled once from a `get`, never by `Name`. Clean duplicates via `*.delete` (mutating — needs the flag) before adding new ones.

## 12. `Keywords.add` is for targeting, not minus-words

Plain `Keywords.add` adds **targeting** keywords. For negative keywords use `runDirectNegativeKeywordsAdd({ account:'<account>', target:{ ad_group_id: gid }, keywords:[...], confirm:true })` — it calls `AdGroups.update` with `NegativeKeywords.Items`.

## 13. `account-resolver` reports a missing scope that IS granted

The MCP `account-resolver` throws `Account '<account>' lacks required scope 'direct:api'` even though `direct:api` is in `scopes_granted`. Bypass it: `getAccessToken(<account_id>)` + call the endpoint directly (or `runYandexDirectApi({ account: <account_id>, ... })`).

## 14. Reports/date ranges use the cabinet timezone

Reports `DateFrom`/`DateTo` are interpreted in the cabinet TZ (Europe/Moscow for RU cabinets). Pre-compute dates with `TZ=Europe/Moscow date +%F` for "yesterday".

## 15. `runDirectModerateAds` needs TWO flags + a per-call ack string

Moderation (`direct-moderate-ads.js`) gates on: (1) `OHMY_SEO_ALLOW_LIVE_MUTATIONS=true`, (2) `YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true` (separate, platform-isolated), (3) `acknowledge_live` equal exactly to `I-UNDERSTAND-MODERATE-LIVE:<account_label>:<campaign_id>` (the tool echoes the expected string in its error). Export both flags in the same shell that runs the script. Moderation only submits DRAFT/NEW ads to review — it does **not** flip campaign ON/OFF. Returns `{"moderated":N,"total_candidates":M,"errors":[...]}`.

```bash
OHMY_SEO_ALLOW_LIVE_MUTATIONS=true YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true \
node -e "import('./packages/yandex-seo/dist/tools/direct-moderate-ads.js').then(async ({runDirectModerateAds})=>{
  const r = await runDirectModerateAds({ campaign_ids:[CID], confirm:true,
    acknowledge_live:'I-UNDERSTAND-MODERATE-LIVE:<account>:'+CID, account:'<account>', client_login:'<client_login>' });
  console.log(JSON.stringify(r,null,2)); });"
```

## 16. BidModifiers on ЕПК: only device + video; `add` returns `Ids` (array); no `toggle`

`/json/v5/bidmodifiers` (v501 works too). On a `UNIFIED_CAMPAIGN` the API accepts **only** `MobileAdjustment`, `DesktopAdjustment`, `DesktopOnlyAdjustment` (mutually exclusive with `Desktop` → error 6000), and `VideoAdjustment`. `DemographicsAdjustment` (пол/возраст), `RegionalAdjustment`, `RetargetingAdjustment`, `AbSegment`, `Weather`, `IncomeGrade`, `InventoryType` all return **8000 «unknown parameter»** on ЕПК — they belong to classic campaign types. Method quirks: `add` returns `AddResults[].Ids` (an **array**, unlike Campaigns/Ads which return `Id`); there is **no `toggle` method and no `Enabled` field** (method `toggle` → error 55) — change a coefficient with `set`; `get` requires `SelectionCriteria.Levels` (`["CAMPAIGN","AD_GROUP"]`) and per-type `<Type>AdjustmentFieldNames`, and its base `FieldNames` accept only `Id, CampaignId, AdGroupId, Level, Type`. `BidModifier` is a percent coefficient (100 = no change). Tool: `runDirectSetBidModifiers({ mode:"add"|"set"|"delete"|"get", … })`.

## 17. `Campaigns.update` on ЕПК: field placement is split (top level vs `UnifiedCampaign`)

On `Campaigns.update` (v501) some fields sit at the **campaign top level** and some **inside `UnifiedCampaign`** — put them in the wrong place and you get 8000 «unknown parameter». Verified live:
- **Top level:** `Name`, `DailyBudget`, `ExcludedSites:{Items}`, `NegativeKeywords:{Items}`, `Notification:{EmailSettings:{…}}` (email is `EmailSettings`, **not** `Notification.Email` → 8000), `TimeTargeting`.
- **Inside `UnifiedCampaign`:** `BiddingStrategy`, `AttributionModel`, `TrackingParams`, `Settings:[{Option,Value}]`, `CounterIds:{Items}`, `PriorityGoals:{Items}`.
- `AttributionModel` takes **short codes only**: `LC, LSC, FC, LYDC, LSCCD, FCCD, LYDCCD, AUTO` (long names → 8000 listing the valid enum).
- **ExtendedGeoTargeting** = the `UnifiedCampaign.Settings` options `ENABLE_AREA_OF_INTEREST_TARGETING` / `ENABLE_CURRENT_AREA_TARGETING` / `ENABLE_REGULAR_AREA_TARGETING`. Full valid ЕПК `Settings.Option` enum: `ADD_METRICA_TAG, ADD_TO_FAVORITES, ENABLE_AREA_OF_INTEREST_TARGETING, ENABLE_CURRENT_AREA_TARGETING, ENABLE_REGULAR_AREA_TARGETING, ENABLE_SITE_MONITORING, REQUIRE_SERVICING, ENABLE_COMPANY_INFO, CAMPAIGN_EXACT_PHRASE_MATCHING_ENABLED, ALTERNATIVE_TEXTS_ENABLED`.
Tool `runDirectUpdateCampaign` routes each field for you; use `raw_fields` / `raw_unified_fields` for anything unsurfaced.

## 18. Frequency capping is NOT settable via the API for ЕПК

Every candidate — `FrequencyCap`, `NetworkFrequencyCap`, at campaign level or inside `UnifiedCampaign` — is rejected as 8000 «unknown parameter». Частота показов can only be set in the UI for ЕПК. Do not promise it via the API.

## 20. Товарные фиды — `Feeds.get` needs Ids OR no SelectionCriteria; `Status` = moderation

`/json/v5/feeds` runs the product-feed service (add/get/update/delete). Quirk: `Feeds.get` with an **empty** `SelectionCriteria: {}` errors 8000 «Omitted required parameter Ids». To **list all** feeds, OMIT `SelectionCriteria` entirely; to fetch specific ones, pass `SelectionCriteria: { Ids: [...] }`. Valid `FieldNames`: `Id, Name, BusinessType, SourceType, FilterSchema, UpdatedAt, CampaignIds, NumberOfItems, NumberOfListings, Status, TitleAndTextSources, Fields` — the **`Status`** field is the feed processing/moderation state (e.g. `NEW`). `Feeds.add` shape: `{ Name, BusinessType, SourceType:"URL", UrlFeed:{Url,…} }` or `SourceType:"FILE", FileFeed:{Filename,Data(base64)}`. The API normalises an unrecognised `BusinessType` to `OTHER`. Tool: `runDirectFeeds({ mode:"add"|"get"|"update"|"delete", … })`. «Мастер кампаний» has no dedicated API create type; `SmartCampaign` / `CpmBannerCampaign` containers ARE accepted (need a valid Search+Network strategy), `DynamicTextCampaign` returns 3500 «creation not supported».

## 21. `PriorityGoals` on UPDATE require `Operation:"SET"` (create must NOT send it)

CounterIds + Metrika goals + conversion value work on ЕПК: `UnifiedCampaign.CounterIds:{Items}` and `UnifiedCampaign.PriorityGoals:{Items:[{GoalId, Value}]}` (Value = ценность/стоимость конверсии in account-currency micros). Asymmetry: on **create** the PriorityGoals items take NO `Operation`; on **update** each item MUST carry `Operation:"SET"` — `ADD`/`REMOVE` return 3500 «only the SET operation is supported» and omitting it returns 8000 «Operation omitted». For conversion-cost bidding, `PAY_FOR_CONVERSION{Cpa,GoalId}` and `AVERAGE_CPA{AverageCpa,GoalId}` are structurally accepted (they reach «goal not found» with a fake goal — i.e. valid shape). The `create_campaign`/`update_campaign` tools expose `priority_goals:[{goal_id, value?}]` and handle the Operation asymmetry for you; the goal must exist in a linked counter.

## 19. `Ads.update` needs a STRING Id; edits can re-trigger moderation

Editing a `RESPONSIVE_AD` via `Ads.update` (v501) hits the same big-int trap as #3: pass `Id` as a **string** or you get 8800 «Ad not found». `runDirectUpdateAd` always stringifies `ad_id`. Only the `ResponsiveAd` sub-fields you pass are changed; changing creative (titles/texts/href/images) can send the ad back to moderation. `Notification.EmailSettings.SendWarnings` may return warning 10165 «Parameter will not be applied» depending on account config — benign, the rest of the update still applies (the tool surfaces `warnings[]`).

## 22. ЕПК bidding strategies — the strategy lives on ONE side; Search+Network compat is strict

Full ЕПК Search `BiddingStrategyType` enum (live): `AVERAGE_CPC, AVERAGE_CPA, PAY_FOR_CONVERSION, WB_MAXIMUM_CONVERSION_RATE, HIGHEST_POSITION, SERVING_OFF, WB_MAXIMUM_CLICKS, AVERAGE_CRR, PAY_FOR_CONVERSION_CRR, MAX_PROFIT, PAY_FOR_CONVERSION_MAX_PROFIT, AVERAGE_CPA_MULTIPLE_GOALS, PAY_FOR_CONVERSION_MULTIPLE_GOALS`. **There is no `AVERAGE_ROI`** on ЕПК — use the CRR (доля рекламных расходов) strategies instead. Compatibility rules (verified live):
- The strategy sits on **one** side (Search OR Network); the other side is `SERVING_OFF` (single placement) or `NETWORK_DEFAULT` (both — networks follow Search). Putting two different auto strategies on both sides → 4000 «These strategies are not compatible». Putting the SAME auto strategy on both sides is ALSO «not compatible».
- `HIGHEST_POSITION` (manual) pairs **only** with Network `SERVING_OFF` (`HIGHEST_POSITION` + `NETWORK_DEFAULT` → «not compatible»). `MAXIMUM_COVERAGE` is not a valid Network type here (`NETWORK_DEFAULT` is).
- Conversion strategies (`AVERAGE_CPA`, `WB_MAXIMUM_CONVERSION_RATE`, `PAY_FOR_CONVERSION`, `*_CRR`) require a real Metrika `GoalId` — a fake one yields 4000 «goal not found», which confirms the STRUCTURE is valid.
- Settings-struct keys: `WB_MAXIMUM_CLICKS→WbMaximumClicks{WeeklySpendLimit,BidCeiling?}`, `AVERAGE_CPC→AverageCpc{AverageCpc,WeeklySpendLimit?}`, `WB_MAXIMUM_CONVERSION_RATE→WbMaximumConversionRate{WeeklySpendLimit,GoalId?,BidCeiling?}`, `AVERAGE_CPA→AverageCpa{AverageCpa,GoalId,WeeklySpendLimit?,BidCeiling?}`, `PAY_FOR_CONVERSION→PayForConversion{Cpa,GoalId}`.
- **Daily budget is meaningful only for manual** — an auto strategy with `DailyBudget` warns 10162 «Дневной бюджет имеет смысл только для ручных стратегий»; auto strategies use `WeeklySpendLimit`.

The `create_campaign`/`update_campaign` tools (and bundle `epk_settings`) expose a typed `strategy` param — `{ type: manual|max_clicks|avg_cpc|max_conversions|avg_cpa|pay_for_conversion|avg_crr|pay_for_conversion_crr|serving_off, placement: search|network|both, weekly_budget_micros?, bid_ceiling_micros?, goal_id?, avg_cpc_micros?, avg_cpa_micros?, cpa_micros?, crr? }` — and `buildEpkBiddingStrategy` maps it to a live-compatible `{ Search, Network }`, so you never hand-assemble the pair (the raw `bidding_strategy` escape hatch still exists).
