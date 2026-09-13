#!/usr/bin/env node
import { config as dotenvConfig } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  callRoistat,
  formatRoistatError,
  resolveProject,
} from "./client.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: false };

function text(payload: unknown, isError = false) {
  const result = { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
  return isError ? { ...result, isError: true as const } : result;
}

async function read(call: () => Promise<unknown>) {
  try {
    return text(await call());
  } catch (error) {
    return text({ error: formatRoistatError(error) }, true);
  }
}

const server = new McpServer(
  { name: "mcp-roistat", version: "0.1.0" },
  {
    instructions:
      "Read-only Roistat analytics. Start with roistat_list_projects, then inspect dimensions and metrics with roistat_list_analytics_fields, and request a report with roistat_get_analytics. The server exposes no arbitrary endpoint or mutation tool.",
  },
);

server.registerTool(
  "roistat_list_projects",
  {
    title: "Roistat — List Projects",
    description: "List projects available to the configured Roistat API key. Does not require a project ID.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => read(() => callRoistat({ path: "/user/projects", method: "GET" })),
);

server.registerTool(
  "roistat_list_analytics_fields",
  {
    title: "Roistat — Analytics Fields",
    description: "List metrics, dimensions, attribution models, or values of one dimension for a project.",
    inputSchema: {
      kind: z.enum(["metrics", "dimensions", "attribution_models", "dimension_values"]),
      project: z.string().min(1).optional().describe("Project ID; defaults to ROISTAT_PROJECT_ID"),
      dimension: z.string().min(1).optional().describe("Required when kind=dimension_values"),
    },
    annotations: READ_ONLY,
  },
  async (args) => read(async () => {
    const project = resolveProject(args.project);
    if (args.kind === "dimension_values" && !args.dimension) {
      throw new Error("dimension is required when kind=dimension_values");
    }
    const route = {
      metrics: "/project/analytics/metrics-new",
      dimensions: "/project/analytics/dimensions",
      attribution_models: "/project/analytics/attribution-models",
      dimension_values: "/project/analytics/dimension-values",
    }[args.kind];
    return callRoistat({
      path: route,
      method: "POST",
      project,
      params: args.dimension ? { dimension: args.dimension } : undefined,
    });
  }),
);

server.registerTool(
  "roistat_get_analytics",
  {
    title: "Roistat — Analytics Report",
    description: "Read an analytics report with dimensions, metrics, period and optional filters. This is the read-only /project/analytics/data endpoint.",
    inputSchema: {
      project: z.string().min(1).optional().describe("Project ID; defaults to ROISTAT_PROJECT_ID"),
      dimensions: z.array(z.string().min(1)).min(1),
      metrics: z.array(z.union([
        z.string().min(1),
        z.object({ metric: z.string().min(1), attribution: z.string().min(1).optional() }),
      ])).min(1),
      period: z.object({ from: z.string().min(1), to: z.string().min(1) }),
      filters: z.array(z.record(z.string(), z.unknown())).optional(),
      interval: z.string().min(1).optional(),
      next_dimensions: z.array(z.string().min(1)).optional(),
    },
    annotations: READ_ONLY,
  },
  async (args) => read(() => callRoistat({
    path: "/project/analytics/data",
    method: "POST",
    project: resolveProject(args.project),
    body: {
      dimensions: args.dimensions,
      metrics: args.metrics,
      period: args.period,
      ...(args.filters ? { filters: args.filters } : {}),
      ...(args.interval ? { interval: args.interval } : {}),
      ...(args.next_dimensions ? { next_dimensions: args.next_dimensions } : {}),
    },
  })),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-roistat v0.1.0 running via stdio");
}

main().catch((error: Error) => {
  console.error("FATAL:", error.message);
  process.exit(1);
});
