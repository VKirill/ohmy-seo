import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { join } from "node:path";
import { ensureFreshAccounts, materialize, purgeResponseCache, tenantDir, type Account } from "./tenant.js";
import { assertHostedCall, isHostedTool, hostedTool } from "./tool-policy.js";
import { tenantKey } from "./crypto.js";

const OHMY_ROOT = process.env.OHMY_SEO_ROOT ?? "/opt/ohmy-seo";
const IDLE_MS = Number(process.env.TENANT_IDLE_MS ?? 15 * 60 * 1000);
/**
 * Largest single JSON-RPC line read from a child. One response is held whole in
 * gateway memory (container limit 1.5 GB, up to 32 parallel calls), and an agent
 * cannot use a report of this size anyway, so oversized answers are refused with
 * a hint to narrow the request rather than buffered.
 */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
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
  { id: "google-ads", entry: "packages/google-ads/dist/index.js", masterKeyEnv: "MCP_GOOGLE_ADS_MASTER_KEY", dbPathEnv: "MCP_GOOGLE_ADS_DB_PATH", requires: "google" },
];

/** Platform-funded SERP tooling; off unless explicitly enabled. */
const SHARED_PACKAGES: PackageSpec[] = [
  { id: "mutagen", entry: "packages/mutagen/dist/index.js", masterKeyEnv: "MCP_MUTAGEN_MASTER_KEY", dbPathEnv: "MCP_MUTAGEN_DB_PATH", requires: null },
  { id: "xmlstock", entry: "packages/xmlstock/dist/index.js", masterKeyEnv: "MCP_XMLSTOCK_MASTER_KEY", dbPathEnv: "MCP_XMLSTOCK_DB_PATH", requires: null },
];

/** A failure the client should see verbatim instead of the generic stub. */
export class GatewayUserError extends Error {
  override name = "GatewayUserError";
}

export type Runtime = {
  userId: number;
  accountSignature: string;
  /** Live children only: a child whose transport closed is removed and respawned on the next call. */
  clients: Map<string, Client>;
  /** Packages that started at boot; ids missing from `clients` are respawned by getRuntime. */
  specs: Map<string, PackageSpec>;
  tenantPath: string;
  toolOwner: Map<string, string>;
  tools: Tool[];
  lastUsedAt: number;
  refreshTimer: NodeJS.Timeout;
};

const runtimes = new Map<number, Runtime>();
const starting = new Map<number, Promise<Runtime>>();
/** Why a child died, so the call it took down gets a clear error. */
const deathCause = new WeakMap<Client, "overflow" | "closed">();

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
    args: [
      "--permission", "--allow-addons",
      `--allow-fs-read=${OHMY_ROOT}`, `--allow-fs-read=${tenantDir(userId)}`,
      `--allow-fs-write=${tenantDir(userId)}`,
      join(OHMY_ROOT, spec.entry),
    ],
    maxBufferSize: MAX_RESPONSE_BYTES,
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
      // The hosted policy gates writes before dispatch; package confirmation gates remain active.
      OHMY_SEO_ALLOW_LIVE_MUTATIONS: "true",
      YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS: "true",
      GOOGLE_ADS_ALLOW_LIVE_MUTATIONS: "true",
    },
    stderr: "pipe",
  });
  // Drain stderr without retaining provider responses or tokens in platform logs.
  transport.stderr?.on("data", () => undefined);
  try { await client.connect(transport); }
  catch (error) { await client.close().catch(() => undefined); throw error; }
  return client;
}


/**
 * Wires a child so its death removes it from the runtime. The SDK closes the
 * transport (killing the process) on a read-buffer overflow, a crash or an exit;
 * without this the dead Client stayed in `clients` and every later call failed
 * with "Not connected" until the idle reaper, which each failing call postponed.
 */
function watchClient(rt: Runtime, id: string, client: Client): void {
  client.onerror = (error) => {
    // The SDK's own message, not child output; it precedes the close it triggers.
    if (error.message.startsWith("ReadBuffer exceeded")) deathCause.set(client, "overflow");
  };
  client.onclose = () => {
    if (!deathCause.has(client)) deathCause.set(client, "closed");
    if (rt.clients.get(id) !== client) return;
    rt.clients.delete(id);
    if (runtimes.get(rt.userId) === rt) {
      console.error(`[runtime] user ${rt.userId}: package ${id} exited (${deathCause.get(client)}), will respawn`);
    }
  };
}

/** Restarts children that died since the last call; runs under the tenant's `starting` lock. */
async function respawnDead(rt: Runtime): Promise<void> {
  for (const [id, spec] of rt.specs) {
    if (rt.clients.has(id)) continue;
    try {
      const c = await spawnPackage(rt.userId, spec, rt.tenantPath);
      rt.clients.set(id, c);
      watchClient(rt, id, c);
      console.log(`[runtime] user ${rt.userId}: package ${id} respawned`);
    } catch {
      console.error(`[runtime] user ${rt.userId}: package ${id} failed to respawn`);
    }
  }
}

export async function getRuntime(userId: number): Promise<Runtime> {
  // Serialize both startup and account-set changes for the same tenant.
  const inFlight = starting.get(userId);
  if (inFlight) return inFlight;

  const boot = (async () => {
    if (!runtimes.has(userId) && runtimes.size + starting.size >= 50) {
      throw new Error("Сервис занят. Повторите запрос позже.");
    }
    const accounts = await ensureFreshAccounts(userId);
    const signature = accounts.map(a => `${a.provider}:${a.connectionId}:${a.label}`).sort().join("|");
    const existing = runtimes.get(userId);
    if (existing && existing.accountSignature === signature) {
      existing.lastUsedAt = Date.now();
      existing.tenantPath = materialize(userId, accounts);
      await respawnDead(existing);
      return existing;
    }
    if (existing) await shutdownRuntime(userId);
    const tenantPath = materialize(userId, accounts);
    const specs = packagesFor(accounts);

    const clients = new Map<string, Client>();
    const started = new Map<string, PackageSpec>();
    const toolOwner = new Map<string, string>();
    const tools: Tool[] = [];
    const rt: Runtime = {
      userId,
      accountSignature: signature,
      clients,
      specs: started,
      tenantPath,
      toolOwner,
      tools,
      lastUsedAt: Date.now(),
      refreshTimer: setInterval(() => {
        void (async () => {
          try {
            const fresh = await ensureFreshAccounts(userId);
            materialize(userId, fresh);
          } catch (e) {
            console.error(`[runtime] refresh for user ${userId} failed`);
          }
        })();
      }, REFRESH_MS),
    };

    for (const spec of specs) {
      try {
        const c = await spawnPackage(userId, spec, tenantPath);
        clients.set(spec.id, c);
        started.set(spec.id, spec);
        watchClient(rt, spec.id, c);
        const listed = await c.listTools();
        for (const t of listed.tools) {
          // ohmy-seo tool names are already unique across packages.
          if (!isHostedTool(t.name) || toolOwner.has(t.name)) continue;
          toolOwner.set(t.name, spec.id);
          tools.push(hostedTool(t));
        }
      } catch (e) {
        console.error(`[runtime] user ${userId}: package ${spec.id} failed to start`);
      }
    }

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

const activeCalls = new Map<number, number>();
let totalCalls = 0;
export async function callTool(userId: number, name: string, args: unknown) {
  const input = (args ?? {}) as Record<string, unknown>;
  assertHostedCall(name, input);
  const active = activeCalls.get(userId) ?? 0;
  if (active >= 4 || totalCalls >= 32) throw new Error("Слишком много одновременных запросов. Повторите позже.");
  activeCalls.set(userId, active + 1); totalCalls++;
  try {
    const rt = await getRuntime(userId);
    rt.lastUsedAt = Date.now();
    const owner = rt.toolOwner.get(name);
    if (!owner) throw new Error("Инструмент недоступен для подключённых аккаунтов.");
    const client = rt.clients.get(owner);
    if (!client) throw new Error("Сервис временно недоступен.");
    try {
      return await client.callTool({ name, arguments: input }, undefined, { timeout: 120000 });
    } catch (e) {
      if (rt.clients.get(owner) === client) throw e;
      // This call took the child down (or was in flight when it died); the next call respawns it.
      if (deathCause.get(client) === "overflow") {
        throw new GatewayUserError(`Ответ слишком большой (больше ${MAX_RESPONSE_BYTES / 1024 / 1024} МБ). Сузьте период, число кампаний или полей и повторите.`);
      }
      throw new GatewayUserError("Сервис перезапускается после сбоя. Повторите запрос.");
    }
  } finally {
    const remaining = (activeCalls.get(userId) ?? 1) - 1;
    if (remaining) activeCalls.set(userId, remaining); else activeCalls.delete(userId);
    totalCalls--;
  }
}

export async function shutdownRuntime(userId: number): Promise<void> {
  const rt = runtimes.get(userId);
  if (!rt) return;
  runtimes.delete(userId);
  clearInterval(rt.refreshTimer);
  await Promise.all([...rt.clients.values()].map((c) => c.close().catch(() => undefined)));
  try { purgeResponseCache(userId); } catch { console.error(`[runtime] user ${userId}: cache purge failed`); }
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
