import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runYandexMetrikaApi } from "../tools/yandex-metrika-api.js";
import { runYandexWebmasterApi } from "../tools/yandex-webmaster-api.js";
import { runYandexDirectApi } from "../tools/yandex-direct-api.js";
import { GENERIC_API_INPUT, READ_ONLY } from "./_shared.js";

export function registerGateways(server: McpServer): void {
  server.registerTool(
    "yandex_metrika_api",
    {
      title: "Yandex Metrika — Generic API Gateway",
      description:
        "Direct gateway to Yandex Metrika (Яндекс.Метрика) REST API. Pass any endpoint path, " +
        "HTTP method, query params, and optional body — the tool handles OAuth, caching (TTL " +
        "MCP_YANDEX_SEO_CACHE_TTL_API, default 3600 s), and error normalisation. " +
        "GET responses are cached; POST/PUT/DELETE bypass cache and invalidate related GET entries. " +
        "Endpoint catalog and usage examples: see skill yandex-metrica (cookbook.md). " +
        "Example: endpoint='/stat/v1/data', params={id:'12345', metrics:'ym:s:visits', date1:'2024-01-01', date2:'2024-01-31'}.",
      inputSchema: GENERIC_API_INPUT,
      annotations: READ_ONLY,
    },
    async (args) =>
      runYandexMetrikaApi({
        endpoint: args.endpoint,
        method: args.method,
        params: args.params,
        body: args.body,
        account: args.account,
        force_refresh: args.force_refresh,
      }),
  );

  server.registerTool(
    "yandex_webmaster_api",
    {
      title: "Yandex Webmaster — Generic API Gateway",
      description:
        "Direct gateway to Yandex Webmaster REST API. Pass any endpoint path, HTTP method, " +
        "query params, and optional body — the tool handles OAuth, caching (TTL " +
        "MCP_YANDEX_SEO_CACHE_TTL_API, default 3600 s), and error normalisation. " +
        "GET responses are cached; POST/PUT/DELETE bypass cache and invalidate related GET entries. " +
        "Endpoint catalog and usage examples: see skill yandex-webmaster (cookbook.md). " +
        "Example: endpoint='/user/2/hosts', method='GET' to list all verified sites in Yandex Webmaster.",
      inputSchema: GENERIC_API_INPUT,
      annotations: READ_ONLY,
    },
    async (args) =>
      runYandexWebmasterApi({
        endpoint: args.endpoint,
        method: args.method,
        params: args.params,
        body: args.body,
        account: args.account,
        force_refresh: args.force_refresh,
      }),
  );

  server.registerTool(
    "yandex_direct_api",
    {
      title: "Yandex Direct — Generic API Gateway",
      description:
        "Direct gateway to Yandex Direct API v5 (Яндекс.Директ). Pass any endpoint path, " +
        "HTTP method, query params, and optional body — the tool handles Bearer OAuth auth, " +
        "optional Client-Login header for agency accounts, caching (TTL " +
        "MCP_YANDEX_SEO_CACHE_TTL_API, default 3600 s), and error normalisation. " +
        "GET responses are cached; POST/PUT/DELETE bypass cache and invalidate related GET entries. " +
        "Endpoint catalog and usage examples: see skill yandex-direct (cookbook.md). " +
        "Pass client_login for agency sub-client access.",
      inputSchema: {
        ...GENERIC_API_INPUT,
        client_login: z.string().optional().describe("Yandex Direct agency client login for sub-client access (optional)"),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      runYandexDirectApi({
        endpoint: args.endpoint,
        method: args.method,
        params: args.params,
        body: args.body,
        account: args.account,
        client_login: args.client_login,
        force_refresh: args.force_refresh,
      }),
  );
}
