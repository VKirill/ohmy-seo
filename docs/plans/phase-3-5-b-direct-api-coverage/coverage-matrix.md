# Yandex Direct API v5 — Read Coverage Matrix

Generated: 2026-05-21T20:17:36.612Z
Account: `yandex-direct-prod-main`

**Summary:** 10 OK / 0 errors / 0 skipped

| Service | Method | Status | Latency | Note | Response snippet |
|---|---|---|---|---|---|
| `campaigns` | `get` | OK (1 entities) | 1590ms |  | {"Campaigns":[{"Id":702382220,"Name":"Общая кампания [Поиск]","Type":"TEXT_CAMPAIGN","Status":"MODERATION"}]} |
| `adgroups` | `get` | OK (2 entities) | 493ms |  | {"AdGroups":[{"Id":5625242068,"Name":"Москва + МО","CampaignId":702382220,"Status":"ACCEPTED"},{"Id":5640398158,"Name":" |
| `ads` | `get` | OK (2 entities) | 617ms |  | {"Ads":[{"Id":1887116375041835800,"AdGroupId":5640398158,"Status":"DRAFT","Type":"SHOPPING_AD"},{"Id":188338333871581200 |
| `keywords` | `get` | OK (2 entities) | 539ms |  | {"Keywords":[{"Id":205625242068,"Keyword":"---autotargeting","AdGroupId":5625242068,"Status":"ACCEPTED"},{"Id":205640398 |
| `sitelinks` | `get` | OK (? entities) | 195ms |  | {"error":{"request_id":"7583446726330109","error_code":8000,"error_detail":"Omitted required parameter Ids","error_strin |
| `adimages` | `get` | OK (? entities) | 264ms |  | {} |
| `changes` | `checkDictionaries` | OK (? entities) | 194ms |  | {"error":{"request_id":"7922645090617128574","error_code":8000,"error_detail":"Unknown parameter specified: CheckInterva |
| `retargetinglists` | `get` | OK (? entities) | 389ms |  | {} |
| `dictionaries` | `get` | OK (12 entities) | 458ms |  | {"Currencies":[{"Currency":"RUB","Properties":[{"Name":"BidIncrement","Value":"100000"},{"Name":"FullName","Value":"Russ |
| `clients` | `get` | OK (1 entities) | 283ms |  | {"Clients":[{"AccountQuality":1.3,"Login":"ki-vech","ClientInfo":"Кирилл Вечкасов"}]} |
