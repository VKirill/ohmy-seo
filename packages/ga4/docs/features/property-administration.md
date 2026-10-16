---
title: GA4 property administration
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: high
tags: [ga4, admin-api, writes]
sources:
  - packages/ga4/src/tools/ga4-create-custom-dimension.ts
  - packages/ga4/src/tools/ga4-update-property.ts
  - packages/ga4/src/tools/ga4-update-custom-dimension.ts
  - packages/ga4/src/tools/ga4-archive-custom-dimension.ts
  - packages/ga4/src/tools/ga4-create-key-event.ts
  - packages/ga4/src/tools/ga4-delete-key-event.ts
  - packages/ga4/src/tools/ga4-update-data-retention.ts
  - packages/ga4/src/lib/confirm-gate.ts
  - packages/ga4/src/lib/ga4-resource-names.ts
  - packages/ga4/src/index.ts
---

# GA4 property administration

TL;DR: Seven write tools change property settings, custom dimensions, key events, or retention settings through the Analytics Admin API; all require explicit confirmation before making an API request (packages/ga4/src/index.ts:303-434).

## Purpose

Manage a GA4 property through an account granted the edit scope (packages/ga4/src/tools/ga4-update-property.ts:66-78, packages/ga4/src/tools/ga4-create-custom-dimension.ts:69-80).

## How it works

1. MCP schemas validate command inputs and dispatch to a write function (packages/ga4/src/index.ts:303-434).
2. The function normalizes resource names, constructs the API path and request body, and validates operation-specific fields (packages/ga4/src/lib/ga4-resource-names.ts:7-23, packages/ga4/src/tools/ga4-update-custom-dimension.ts:43-65).
3. Without confirm=true, it returns a preview before account resolution or token retrieval (packages/ga4/src/lib/confirm-gate.ts:51-63, packages/ga4/src/tools/ga4-create-custom-dimension.ts:64-71).
4. With confirmation, it resolves an account with edit scope and calls the Admin API (packages/ga4/src/tools/ga4-update-property.ts:66-78).
5. Non-OK responses become MCP errors; successful operations invalidate matching metadata cache where a read tool exists (packages/ga4/src/tools/ga4-update-property.ts:80-93, packages/ga4/src/tools/ga4-create-custom-dimension.ts:82-91).

### Modes

| Operation | Change | Specific behavior |
|---|---|---|
| Update property | displayName, timeZone, currencyCode, industryCategory. | Requires at least one field; updateMask lists supplied fields (packages/ga4/src/tools/ga4-update-property.ts:40-59). |
| Create custom dimension | parameterName, displayName, scope, optional description and ads-personalization flag. | Ads flag is valid only with USER scope (packages/ga4/src/tools/ga4-create-custom-dimension.ts:22-31, packages/ga4/src/tools/ga4-create-custom-dimension.ts:44-62). |
| Update custom dimension | displayName, description, ads flag. | Requires at least one field; updateMask lists supplied fields (packages/ga4/src/tools/ga4-update-custom-dimension.ts:46-65). |
| Archive custom dimension | Custom-dimension resource name. | Irreversible; archived parameterName cannot be reused (packages/ga4/src/tools/ga4-archive-custom-dimension.ts:37-45). |
| Create key event | eventName and countingMethod. | Counting method is ONCE_PER_EVENT or ONCE_PER_SESSION (packages/ga4/src/index.ts:382-398). |
| Delete key event | Key-event resource name. | Irreversible delete (packages/ga4/src/tools/ga4-delete-key-event.ts:31-74). |
| Update data retention | Event/user duration and resetUserDataOnNewActivity. | Requires one field; no paired read tool/cache exists (packages/ga4/src/tools/ga4-update-data-retention.ts:39-63). |

## Business rules

- confirm defaults to false; preview makes no API call and fetches no token (packages/ga4/src/lib/confirm-gate.ts:31-36, packages/ga4/src/index.ts:303-305).
- Confirmed calls require the GA4 edit scope (packages/ga4/src/tools/ga4-update-property.ts:66-78).
- Update operations reject empty field sets and use only supplied fields in body and updateMask (packages/ga4/src/tools/ga4-update-property.ts:40-59, packages/ga4/src/tools/ga4-update-custom-dimension.ts:46-65).
- disallowAdsPersonalization is allowed only when creating a USER-scoped custom dimension (packages/ga4/src/tools/ga4-create-custom-dimension.ts:44-53).
- The supplied code map marked custom dimension creation as a business-rule candidate; source confirms the USER-scope rule and preview-before-network ordering (packages/ga4/src/tools/ga4-create-custom-dimension.ts:33-71).

## Public API

The seven MCP command schemas and input fields are listed in [API](../api.md#ga4-property-administration). The handlers are:

| Handler | Source | Purpose |
|---|---|---|
| runGa4UpdateProperty | packages/ga4/src/index.ts:306-324 | Update property settings. |
| runGa4CreateCustomDimension, runGa4UpdateCustomDimension, runGa4ArchiveCustomDimension | packages/ga4/src/index.ts:326-380 | Create, update, or archive a custom dimension. |
| runGa4CreateKeyEvent, runGa4DeleteKeyEvent | packages/ga4/src/index.ts:382-412 | Create or delete a key event. |
| runGa4UpdateDataRetention | packages/ga4/src/index.ts:414-434 | Update data-retention settings. |
## Package shape

Tool-specific payloads live in src/tools; confirmation previews use src/lib/confirm-gate.ts; name normalization and update masks use src/lib/ga4-resource-names.ts (packages/ga4/src/lib/ga4-resource-names.ts:1-24).

## Internal model

Each function creates a Google REST request with Admin API base URL and selected body. Patch tools convert supplied camelCase fields to snake_case mask names (packages/ga4/src/lib/ga4-resource-names.ts:21-23, packages/ga4/src/tools/ga4-update-data-retention.ts:45-86).

## Dependencies

Write tools use MCP core for scopes, cache deletion, and MCP error formatting; the shared client sends the requests (packages/ga4/src/tools/ga4-create-custom-dimension.ts:11-18).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Analytics 4 workspace overview](../overview.md)
