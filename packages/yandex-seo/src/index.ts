#!/usr/bin/env node
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getMasterKey } from "@ohmy-seo/mcp-core/crypto";
import { registerOauth } from "./registry/oauth.js";
import { registerInventory } from "./registry/inventory.js";
import { registerCache } from "./registry/cache.js";
import { registerGateways } from "./registry/gateways.js";
import { registerDirectRead } from "./registry/direct-read.js";
import { registerDirectWrite } from "./registry/direct-write.js";
import { registerDirectBundle } from "./registry/direct-bundle.js";

const server = new McpServer(
  { name: "mcp-yandex-seo", version: "0.7.0" },
  {
    instructions:
      "You have access to mcp-yandex-seo: 17 tools for Russian SEO analytics and Yandex API access. " +
      "Generic API gateways (use these for full API coverage): " +
      "yandex_metrika_api — any Yandex Metrika endpoint; see skill yandex-metrica (cookbook.md) for examples. " +
      "yandex_webmaster_api — any Yandex Webmaster endpoint; see skill yandex-webmaster (cookbook.md). " +
      "yandex_direct_api — any Yandex Direct v5 endpoint (Bearer auth, optional client_login); see skill yandex-direct (cookbook.md). " +
      "Inventory tools: list_sites, list_counters, find_property, refresh_inventory. " +
      "OAuth management: list_oauth_apps, register_oauth_app, delete_oauth_app, list_accounts, start_oauth_flow, complete_oauth_flow, delete_account, set_default_account. " +
      "Cache tools: invalidate_cache, cache_stats. " +
      "GET responses are cached (TTL MCP_YANDEX_SEO_CACHE_TTL_API, default 3600 s). " +
      "On rate-limit errors, wait the seconds suggested in the error text before retry. " +
      "Most tools accept an optional 'account' parameter to select a specific connected Yandex account.",
  },
);

function validateRequiredEnv(): void {
  try {
    getMasterKey();
  } catch (err) {
    console.error("FATAL: " + (err as Error).message);
    process.exit(1);
  }
}

registerOauth(server);
registerInventory(server);
registerCache(server);
registerGateways(server);
registerDirectRead(server);
registerDirectWrite(server);
registerDirectBundle(server);

async function main(): Promise<void> {
  validateRequiredEnv();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-yandex-seo v0.7.0 running via stdio");
}

main().catch((err: Error) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
