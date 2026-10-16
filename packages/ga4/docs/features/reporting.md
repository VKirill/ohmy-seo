---
title: GA4 reporting and metadata
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [ga4, reporting, metadata]
sources:
  - packages/ga4/src/tools/ga4-run-report.ts
  - packages/ga4/src/tools/ga4-run-realtime-report.ts
  - packages/ga4/src/tools/ga4-batch-run-reports.ts
  - packages/ga4/src/tools/ga4-run-pivot-report.ts
  - packages/ga4/src/tools/ga4-get-metadata.ts
  - packages/ga4/src/tools/ga4-list-properties.ts
  - packages/ga4/src/lib/ga4-client.ts
  - packages/ga4/src/index.ts
  - packages/ga4/src/lib/account-resolver.ts
---

# GA4 reporting and metadata

TL;DR: Read tools return property, metadata, dimension, and key-event data; four report modes send requests to Analytics Data API (packages/ga4/src/index.ts:179-301).

## Purpose

Use an account with analytics.readonly to inspect properties and metadata or run reports (packages/ga4/src/tools/ga4-run-report.ts:35-70, packages/ga4/src/tools/ga4-list-properties.ts:16-35).

## How it works

1. The MCP server validates inputs with Zod schemas and dispatches commands to run functions (packages/ga4/src/index.ts:181-301).
2. The operation selects the named account or default and requires read-only scope (packages/ga4/src/lib/account-resolver.ts:30-57).
3. It normalizes bare property IDs to properties/{id}, builds the API path/body, and calls Data API or Admin API (packages/ga4/src/tools/ga4-run-report.ts:35-53, packages/ga4/src/tools/ga4-get-metadata.ts:20-25).
4. Cached reads use tool, account, path, and arguments as cache inputs and skip cache on API errors; realtime calls bypass cache (packages/ga4/src/tools/ga4-run-report.ts:54-71, packages/ga4/src/tools/ga4-run-realtime-report.ts:26-50).
5. The shared client obtains a Google token, sends HTTP, classifies API/auth failures, and returns response data (packages/ga4/src/lib/ga4-client.ts:44-117).

### Modes

| Mode | Inputs and limits | API and cache | Failure |
|---|---|---|---|
| Standard report | Dimensions, metrics, date ranges; optional filters, ordering, positive limit, nonnegative offset, empty rows, quota (packages/ga4/src/index.ts:207-222). | POST runReport; TTL default 3,600 seconds (packages/ga4/src/index.ts:42-50). | Non-OK response becomes isError; thrown errors become MCP error content (packages/ga4/src/tools/ga4-run-report.ts:73-85). |
| Realtime | Metrics required; dimensions, filters, ordering, positive limit, minute ranges, quota optional (packages/ga4/src/index.ts:235-252). | POST runRealtimeReport; no cache (packages/ga4/src/index.ts:40-50, packages/ga4/src/tools/ga4-run-realtime-report.ts:43-50). | Non-OK and thrown errors become MCP errors (packages/ga4/src/tools/ga4-run-realtime-report.ts:52-64). |
| Batch | 1–5 RunReport request objects, without property (packages/ga4/src/index.ts:263-272). | POST batchRunReports; TTL default 3,600 seconds (packages/ga4/src/tools/ga4-batch-run-reports.ts:27-52). | Non-OK and thrown errors become MCP errors (packages/ga4/src/tools/ga4-batch-run-reports.ts:54-66). |
| Pivot | Dimensions, metrics, date ranges, and at least one pivot; each pivot can set fields, ordering, offset, limit, aggregations (packages/ga4/src/index.ts:274-301). | POST runPivotReport; TTL default 3,600 seconds (packages/ga4/src/tools/ga4-run-pivot-report.ts:39-73). | Non-OK and thrown errors become MCP errors (packages/ga4/src/tools/ga4-run-pivot-report.ts:75-87). |
| Metadata | Account summaries need account; property metadata, custom dimensions, and key events also need property (packages/ga4/src/index.ts:181-203). | Read cache TTL default 86,400 seconds (packages/ga4/src/index.ts:42-47). | Non-OK and thrown errors become MCP errors (packages/ga4/src/tools/ga4-list-properties.ts:38-60, packages/ga4/src/tools/ga4-get-metadata.ts:44-56). |

## Business rules

- Account can be omitted only when a default exists; property accepts a bare ID or a properties/... name (packages/ga4/src/index.ts:100-102, packages/ga4/src/lib/account-resolver.ts:35-47, packages/ga4/src/tools/ga4-run-report.ts:16-18).
- Every read requires granted analytics.readonly scope (packages/ga4/src/tools/ga4-run-report.ts:37, packages/ga4/src/tools/ga4-get-metadata.ts:22).
- Cache is used only for successful results; realtime is uncached (packages/ga4/src/tools/ga4-run-report.ts:54-61, packages/ga4/src/tools/ga4-run-realtime-report.ts:43-50).

## Public API

The public MCP command schemas are listed in [API](../api.md#reporting-and-metadata). The handlers registered by this workspace are:

| Handler | Source | Purpose |
|---|---|---|
| runGa4ListProperties, runGa4GetMetadata | packages/ga4/src/index.ts:181-191 | List accessible properties and available fields. |
| runGa4ListCustomDimensions, runGa4ListConversionEvents | packages/ga4/src/index.ts:193-203 | Read dimensions and key events. |
| runGa4RunReport, runGa4RunRealtimeReport | packages/ga4/src/index.ts:207-261 | Run standard and realtime reports. |
| runGa4BatchRunReports, runGa4RunPivotReport | packages/ga4/src/index.ts:263-301 | Run batched and pivot reports. |
## Package shape

Report request modes live under `src/tools/ga4-run-*` and `ga4-batch-run-reports.ts`. Metadata reads use `ga4-list-*` and `ga4-get-metadata.ts`. Account resolution and HTTP/token handling live under `src/lib` (packages/ga4/src/lib/ga4-client.ts:1-10).

## Internal model

Tools build GA4 paths and JSON bodies and share an authenticated request layer. Standard, batch, pivot, and metadata calls pass account IDs and request arguments to caching; realtime bypasses it (packages/ga4/src/tools/ga4-run-report.ts:41-70, packages/ga4/src/tools/ga4-run-realtime-report.ts:32-50).

## Dependencies

The feature uses core cache, Google OAuth, HTTP, and error helpers (packages/ga4/src/tools/ga4-run-report.ts:1-5, packages/ga4/src/lib/ga4-client.ts:1-9).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Analytics 4 workspace overview](../overview.md)
