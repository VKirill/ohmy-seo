import { z } from "zod";

export const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: false };

export const GENERIC_API_INPUT = {
  endpoint: z.string().min(1).describe("API endpoint path, e.g. '/user/2/hosts' or '/stat/v1/data'"),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().describe("HTTP method (default: GET)"),
  params: z.record(z.string(), z.unknown()).optional().describe("Query string parameters as key-value object (GET requests)"),
  body: z.unknown().optional().describe("Request body for POST/PUT requests (will be JSON-serialised)"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if one default account is configured)"),
  force_refresh: z.boolean().optional().describe("If true, bypass cache read and re-fetch from upstream API, overwriting any cached entry"),
};
