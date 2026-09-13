import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@modelcontextprotocol/sdk": fileURLToPath(new URL("./apps/gateway/node_modules/@modelcontextprotocol/sdk/dist/esm", import.meta.url)), "next": fileURLToPath(new URL("./apps/web/node_modules/next", import.meta.url)), "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
