## Now
- MCP servers provide Yandex Direct, Metrika, and Webmaster tools for campaign operations and analytics.
- Google integrations provide Search Console and indexing, GA4 reporting, Tag Manager management, and hosted Google Ads tools with confirmed writes.
- Mutagen and XMLStock provide keyword competition, parsing, and live or archived SERP data.
- Roistat provides read-only project, analytics-field, and report access.

## Blocked
- None.

## Next
- [ ] Verify hosted Google Ads tools on the live MCP after the v0.11.0 deployment.

## Last verify
- command: `npm ci --prefix hosting --no-audit --no-fund && npm ci --prefix hosting/apps/gateway --no-audit --no-fund --ignore-scripts && cd hosting && npx vitest run --config vitest.config.ts tests/tool-policy.test.ts tests/runtime.test.ts`
- result: green (28 tests across 2 files; `git diff --check` passed)
- when: 2026-10-02

## Pointers
- Changelog: [.agents/CHANGELOG.md](CHANGELOG.md)
- Run evidence: [.agents/runs/lprun_8244c3acbdd94db5a2dc8a1e99b2bdaf/artifacts/hosted-google-ads-3/report.md](runs/lprun_8244c3acbdd94db5a2dc8a1e99b2bdaf/artifacts/hosted-google-ads-3/report.md)
- No open todos, active plans, or planning runs with STATUS.md are currently indexed.
