# Real CSV upload — drafts left in cabinet

**Timestamp:** 2026-05-21T22:02:01.850Z
**Account:** yandex-direct-prod-main (ki.vech)
**Source CSV:** /home/ubuntu/downloads/test_direct.csv
**Max clusters:** 3 (first 3 from CSV)

## Result
- Status: completed
- Campaigns created: [710099894,710099907,710099927]
- Ad groups: [5753426907,5753426943]
- Keywords added: 25
- Ads created: [17725495511,17725495512,17725495596,17725495598]
- Metrika linked: true
- Errors: []

## Where to see them
- Direct UI: https://direct.yandex.ru → Drafts / All campaigns
- Filter campaigns by name prefix `phase-3-5-c-test_`

## How to clean up later
```bash
cd /home/ubuntu/tools/ohmy-seo && npx tsx packages/yandex-seo/scripts/bundle-recovery.ts --ledger /home/ubuntu/tools/ohmy-seo/packages/yandex-seo/data/bundle-ledger-328d0b451746-1779400921859.jsonl --account yandex-direct-prod-main
```

## Ledger
/home/ubuntu/tools/ohmy-seo/packages/yandex-seo/data/bundle-ledger-328d0b451746-1779400921859.jsonl
