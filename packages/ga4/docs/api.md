---
title: GA4 MCP API
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [ga4, mcp, api]
sources:
  - packages/ga4/src/index.ts
  - packages/ga4/src/lib/ga4-client.ts
  - packages/ga4/src/lib/account-resolver.ts
  - packages/ga4/src/lib/confirm-gate.ts
  - packages/ga4/src/tools/start-google-oauth-flow.ts
  - packages/ga4/src/tools/ga4-run-report.ts
  - packages/ga4/src/tools/ga4-update-property.ts
  - packages/ga4/src/tools/ga4-create-custom-dimension.ts
  - packages/ga4/src/tools/register-google-service-account.ts
  - packages/ga4/src/tools/ga4-run-realtime-report.ts
  - packages/ga4/package.json
---

# GA4 MCP API

TL;DR: The server exposes 24 MCP tools over stdio; Google methods and paths below describe downstream requests, while credential commands operate on local SQLite records (packages/ga4/src/index.ts:58-73, packages/ga4/src/index.ts:104-434).

## Purpose

This page lists registered MCP commands and downstream Google REST methods. MCP callers invoke tool names over stdio; this workspace defines no HTTP routes (packages/ga4/src/index.ts:8-10, packages/ga4/src/index.ts:436-440).

## How it works

1. The MCP client calls a registered tool with JSON arguments; Zod validates declared fields (packages/ga4/src/index.ts:84-90, packages/ga4/src/index.ts:104-434).
2. Credential commands read or modify local records. GA4 calls resolve an account and check its scopes (packages/ga4/src/lib/account-resolver.ts:30-57).
3. API tools call the Data or Admin API through executeGa4Call, which attaches a bearer token and sends method, path, and JSON body (packages/ga4/src/lib/ga4-client.ts:44-97).

### Modes

| Group | Caller | Auth |
|---|---|---|
| Google account and OAuth | MCP client/operator | MCP invocation; Google consent or service-account key is needed during credential exchange. |
| Reporting and metadata | MCP client | Account with analytics.readonly. |
| Property administration | MCP client | Account with analytics.edit; confirm=true executes writes. |

### Failures

Unknown accounts, missing defaults, insufficient scopes, credential failures, API errors, and rate limits flow through resolution/client handlers (packages/ga4/src/lib/account-resolver.ts:35-55, packages/ga4/src/lib/ga4-client.ts:94-116). Write previews return without contacting Google (packages/ga4/src/lib/confirm-gate.ts:51-63).

## Google account and OAuth

Each command is invoked by an MCP client; these commands inspect or mutate local GA4 package state except where Google token endpoints are named.

| MCP command | Method and path | Caller and behavior | Auth |
|---|---|---|---|
| list_google_oauth_apps | Local SELECT | Lists registered apps; omits secret. | MCP invocation. |
| register_google_oauth_app | Local INSERT | Stores OAuth client data. | MCP invocation. |
| delete_google_oauth_app | Local DELETE | Deletes only if no accounts refer to app. | MCP invocation. |
| list_google_accounts | Local SELECT | Lists connected accounts; omits tokens. | MCP invocation. |
| start_google_oauth_flow | OAuth authorization and token exchange | Starts loopback browser OAuth and saves account. | Google consent and declared scopes. |
| complete_google_oauth_flow | None | Deprecated command; always errors. | No Google call. |
| delete_google_account | Local DELETE | Removes saved account credentials. | MCP invocation. |
| set_default_google_account | Local UPDATE | Changes selected default. | MCP invocation. |
| register_google_service_account | JWT token exchange | Verifies and saves service account. | Service-account key and scopes. |

Registrations: packages/ga4/src/index.ts:104-177. Persistence and flow: packages/ga4/src/tools/start-google-oauth-flow.ts:13-82, packages/ga4/src/tools/register-google-service-account.ts:18-52.

## Reporting and metadata

| MCP command | Method and Google path | Purpose | Auth |
|---|---|---|---|
| ga4_list_properties | GET v1beta/accountSummaries | Lists property summaries. | analytics.readonly |
| ga4_get_metadata | GET v1beta/{property}/metadata | Lists dimensions and metrics. | analytics.readonly |
| ga4_list_custom_dimensions | GET v1beta/{property}/customDimensions | Lists custom dimensions. | analytics.readonly |
| ga4_list_conversion_events | GET v1beta/{property}/keyEvents | Lists key events. | analytics.readonly |
| ga4_run_report | POST v1beta/{property}:runReport | Standard report. | analytics.readonly |
| ga4_run_realtime_report | POST v1beta/{property}:runRealtimeReport | Realtime report. | analytics.readonly |
| ga4_batch_run_reports | POST v1beta/{property}:batchRunReports | Runs 1–5 report requests. | analytics.readonly |
| ga4_run_pivot_report | POST v1beta/{property}:runPivotReport | Pivot report; at least one pivot. | analytics.readonly |

Input schemas: packages/ga4/src/index.ts:181-301. Request construction: packages/ga4/src/tools/ga4-run-report.ts:35-70, packages/ga4/src/tools/ga4-run-realtime-report.ts:26-50.

## GA4 property administration

| MCP command | Method and Google path | Purpose | Auth |
|---|---|---|---|
| ga4_update_property | PATCH v1beta/{property} | Updates supplied displayName, timeZone, currencyCode, industryCategory. | analytics.edit; confirm=true. |
| ga4_create_custom_dimension | POST v1beta/{property}/customDimensions | Creates dimension; ads flag only with USER scope. | analytics.edit; confirm=true. |
| ga4_update_custom_dimension | PATCH v1beta/{property}/customDimensions/{id} | Updates supplied displayName, description, ads flag. | analytics.edit; confirm=true. |
| ga4_archive_custom_dimension | POST v1beta/{property}/customDimensions/{id}:archive | Archives dimension; irreversible. | analytics.edit; confirm=true. |
| ga4_create_key_event | POST v1beta/{property}/keyEvents | Creates key event and count method. | analytics.edit; confirm=true. |
| ga4_delete_key_event | DELETE v1beta/{property}/keyEvents/{id} | Deletes key event; irreversible. | analytics.edit; confirm=true. |
| ga4_update_data_retention | PATCH v1beta/{property}/dataRetentionSettings | Updates supplied retention fields. | analytics.edit; confirm=true. |

Schemas and handlers: packages/ga4/src/index.ts:303-434. Confirmation behavior: packages/ga4/src/lib/confirm-gate.ts:31-63, packages/ga4/src/tools/ga4-update-property.ts:61-78.

## Public API

The registered MCP tool set is the public interface. Operation functions are module exports, while package.json points to the server executable (packages/ga4/package.json:8-10, packages/ga4/src/index.ts:104-177).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google account and OAuth management](features/accounts-and-oauth.md)
- [GA4 property administration](features/property-administration.md)
- [GA4 reporting and metadata](features/reporting.md)
- [Google Analytics 4 workspace overview](overview.md)
