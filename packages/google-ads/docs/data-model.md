---
title: Google Ads Data Model
type: data-model
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [google-ads, data-model, credentials]
sources:
  - packages/core/src/db/migrations.ts
  - packages/google-ads/src/lib/db/accounts-repo.ts
  - packages/google-ads/src/lib/db/oauth-apps-repo.ts
  - packages/google-ads/src/lib/account-resolver.ts
---

# Google Ads Data Model

**TL;DR:** Google Ads persists two credential entities in the shared SQLite database: OAuth app definitions and connected Google Ads accounts.

## Schema overview

```mermaid
erDiagram
  GOOGLE_OAUTH_APPS ||--o{ GOOGLE_ACCOUNTS : "oauth_app_id"
  GOOGLE_OAUTH_APPS {
    integer id PK
    text label UK
    blob client_secret_enc
  }
  GOOGLE_ACCOUNTS {
    integer id PK
    text label UK
    text auth_method
    integer oauth_app_id FK
    integer is_default
  }
```

The core migration defines both tables and the foreign key from user accounts to OAuth apps (`packages/core/src/db/migrations.ts:143-173`). Their detailed fields, transitions, and readers/writers are in [account credentials](data-model/account-credentials.md).

## Ownership

`@ohmy-seo/mcp-core` owns database creation and the table definitions; `@ohmy-seo/google-ads` owns the repository behavior and use cases for these records (`packages/core/src/db/migrations.ts:143-173`, `packages/google-ads/src/lib/db/accounts-repo.ts:88-100`, `packages/google-ads/src/lib/db/oauth-apps-repo.ts:46-57`).

## Related pages

- [Account credentials](data-model/account-credentials.md) — field meanings, default-account transition, lifecycle, and use cases.
- [Account access](features/account-access.md) — the MCP operations that create, select, and delete these records.

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Ads Account Access](features/account-access.md)
- [Google Ads Workspace — Overview](overview.md)
