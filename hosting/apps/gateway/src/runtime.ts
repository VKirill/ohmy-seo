import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { join } from "node:path";
import { ensureFreshAccounts, materialize, tenantDir, type Account } from "./tenant.js";
import { tenantKey } from "./crypto.js";

const OHMY_ROOT = process.env.OHMY_SEO_ROOT ?? "/opt/ohmy-seo";
const IDLE_MS = Number(process.env.TENANT_IDLE_MS ?? 15 * 60 * 1000);
const REFRESH_MS = Number(process.env.TENANT_REFRESH_MS ?? 4 * 60 * 1000);

type PackageSpec = {
  id: string;
  entry: string;
  masterKeyEnv: string;
  dbPathEnv: string;
  /** Which provider must be connected for this server to be worth starting. */
  requires: "yandex" | "google" | null;
};

const PACKAGES: PackageSpec[] = [
  { id: "yandex-seo", entry: "packages/yandex-seo/dist/index.js", masterKeyEnv: "MCP_YANDEX_SEO_MASTER_KEY", dbPathEnv: "MCP_YANDEX_SEO_DB_PATH", requires: "yandex" },
  { id: "gsc", entry: "packages/google-search-console/dist/index.js", masterKeyEnv: "MCP_GSC_MASTER_KEY", dbPathEnv: "MCP_GSC_DB_PATH", requires: "google" },
  { id: "ga4", entry: "packages/ga4/dist/index.js", masterKeyEnv: "MCP_GA4_MASTER_KEY", dbPathEnv: "MCP_GA4_DB_PATH", requires: "google" },
  { id: "gtm", entry: "packages/gtm/dist/index.js", masterKeyEnv: "MCP_GTM_MASTER_KEY", dbPathEnv: "MCP_GTM_DB_PATH", requires: "google" },
];

/** Platform-funded SERP tooling; off unless explicitly enabled. */
const SHARED_PACKAGES: PackageSpec[] = [
  { id: "mutagen", entry: "packages/mutagen/dist/index.js", masterKeyEnv: "MCP_MUTAGEN_MASTER_KEY", dbPathEnv: "MCP_MUTAGEN_DB_PATH", requires: null },
  { id: "xmlstock", entry: "packages/xmlstock/dist/index.js", masterKeyEnv: "MCP_XMLSTOCK_MASTER_KEY", dbPathEnv: "MCP_XMLSTOCK_DB_PATH", requires: null },
];

export type Runtime = {
  userId: number;
  accountSignature: string;
  clients: Map<string, Client>;
  toolOwner: Map<string, string>;
  tools: Tool[];
  lastUsedAt: number;
  refreshTimer: NodeJS.Timeout;
};

const runtimes = new Map<number, Runtime>();
const starting = new Map<number, Promise<Runtime>>();

function packagesFor(accounts: Account[]): PackageSpec[] {
  const providers = new Set<string>(accounts.map((a) => a.provider));
  // Direct is a separate OAuth app but the same MCP server serves it.
  if (providers.has("yandex-direct") || providers.has("yandex-api")) providers.add("yandex");
  const wanted = PACKAGES.filter((p) => p.requires === null || providers.has(p.requires));
  if (process.env.ENABLE_SHARED_SERP === "true") wanted.push(...SHARED_PACKAGES);
  return wanted;
}

async function spawnPackage(userId: number, spec: PackageSpec, tenantPath: string): Promise<Client> {
  const client = new Client({ name: "ohmy-seo-gateway", version: "0.1.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    cwd: tenantDir(userId),
    command: process.env.NODE_BIN ?? "node",
    args: [join(OHMY_ROOT, spec.entry)],
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: tenantDir(userId),
      [spec.masterKeyEnv]: tenantKey(userId).toString("hex"),
      [spec.dbPathEnv]: tenantPath,
      // Shared cache helpers use the legacy DB path even in Google packages.
      MCP_YANDEX_SEO_DB_PATH: tenantPath,
      MUTAGEN_API_KEY: process.env.MUTAGEN_API_KEY ?? "",
      XMLSTOCK_USER: process.env.XMLSTOCK_USER ?? "",
      XMLSTOCK_KEY: process.env.XMLSTOCK_KEY ?? "",
      // Write stays off unless the operator opts in for the whole platform.
      OHMY_SEO_ALLOW_LIVE_MUTATIONS: process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS ?? "",
      YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS: process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS ?? "",
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  return client;
}


export async function getRuntime(userId: number): Promise<Runtime> {
  // Serialize both startup and account-set changes for the same tenant.
  const inFlight = starting.get(userId);
  if (inFlight) return inFlight;

  const boot = (async () => {
    const accounts = await ensureFreshAccounts(userId);
    const signature = accounts.map(a => `${a.provider}:${a.connectionId}:${a.label}`).sort().join("|");
    const existing = runtimes.get(userId);
    if (existing && existing.accountSignature === signature) {
      existing.lastUsedAt = Date.now();
      materialize(userId, accounts);
      return existing;
    }
    if (existing) await shutdownRuntime(userId);
    const tenantPath = materialize(userId, accounts);
    const specs = packagesFor(accounts);

    const clients = new Map<string, Client>();
    const toolOwner = new Map<string, string>();
    const tools: Tool[] = [];

    for (const spec of specs) {
      try {
        const c = await spawnPackage(userId, spec, tenantPath);
        clients.set(spec.id, c);
        const listed = await c.listTools();
        for (const t of listed.tools) {
          // ohmy-seo tool names are already unique across packages.
          if (toolOwner.has(t.name)) continue;
          toolOwner.set(t.name, spec.id);
          tools.push(t);
        }
      } catch (e) {
        console.error(`[runtime] user ${userId}: package ${spec.id} failed to start:`, e);
      }
    }

    const rt: Runtime = {
      userId,
      accountSignature: signature,
      clients,
      toolOwner,
      tools,
      lastUsedAt: Date.now(),
      refreshTimer: setInterval(() => {
        void (async () => {
          try {
            const fresh = await ensureFreshAccounts(userId);
            materialize(userId, fresh);
          } catch (e) {
            console.error(`[runtime] refresh for user ${userId} failed:`, e);
          }
        })();
      }, REFRESH_MS),
    };
    runtimes.set(userId, rt);
    console.log(`[runtime] user ${userId}: ${clients.size} servers, ${tools.length} tools`);
    return rt;
  })();

  starting.set(userId, boot);
  try {
    return await boot;
  } finally {
    starting.delete(userId);
  }
}

export async function callTool(userId: number, name: string, args: unknown) {
  const rt = await getRuntime(userId);
  rt.lastUsedAt = Date.now();
  const owner = rt.toolOwner.get(name);
  if (!owner) throw new Error(`unknown tool: ${name}`);
  const client = rt.clients.get(owner);
  if (!client) throw new Error(`server ${owner} is not running`);
  return client.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> });
}

export async function shutdownRuntime(userId: number): Promise<void> {
  const rt = runtimes.get(userId);
  if (!rt) return;
  runtimes.delete(userId);
  clearInterval(rt.refreshTimer);
  await Promise.all([...rt.clients.values()].map((c) => c.close().catch(() => undefined)));
  console.log(`[runtime] user ${userId}: stopped`);
}

/** Reaps idle tenants so a long-lived container does not accumulate processes. */
setInterval(() => {
  const cutoff = Date.now() - IDLE_MS;
  for (const [userId, rt] of runtimes) {
    if (rt.lastUsedAt < cutoff) void shutdownRuntime(userId);
  }
}, 60_000).unref();

export async function shutdownAll(): Promise<void> {
  await Promise.all([...runtimes.keys()].map((id) => shutdownRuntime(id)));
}
