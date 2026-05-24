import { request } from "@ohmy-seo/mcp-core/http";

const BASE_URL = "http://api.mutagen.ru/json";

function getApiKey(): string {
  const k = process.env.MUTAGEN_API_KEY;
  if (!k) throw new Error("MUTAGEN_API_KEY is required for mutagen_competition tool");
  return k;
}

// ---------------------------------------------------------------------------
// Async method configuration
// Each async method has its own ID field, poll method name, poll param name,
// and terminal status sets.  check_key and parser.mass differ in ALL four.
// ---------------------------------------------------------------------------

interface AsyncConfig {
  newField: string;           // field in .new response containing the ID
  pollMethod: string;         // method suffix to call for polling (appended after "mutagen.")
  pollParam: string;          // query param name for the ID
  terminalSuccess: string[];  // status values meaning "done with data"
  terminalFail: string[];     // status values meaning "failed"
}

const ASYNC_CONFIG: Record<string, AsyncConfig> = {
  "check_key": {
    newField: "task_id",
    pollMethod: "check_key.get",
    pollParam: "task_id",
    terminalSuccess: ["completed"],
    terminalFail: ["rejected", "error"],
  },
  "parser.mass": {
    newField: "id",
    pollMethod: "parser.mass.id",
    pollParam: "mass_id",
    terminalSuccess: ["finish"],
    terminalFail: ["error"],
  },
};

// ---------------------------------------------------------------------------
// POST vs GET routing
// ---------------------------------------------------------------------------

function shouldUsePost(method: string, params: Record<string, unknown>): boolean {
  if (method === "serp.report") return true;
  for (const v of Object.values(params)) {
    if (Array.isArray(v) || (typeof v === "object" && v !== null)) return true;
  }
  return false;
}

/**
 * Generic Mutagen method executor.
 *
 * Sync methods:
 *   - GET if all param values are scalars (default for most methods)
 *   - POST with JSON body if method is serp.report OR any param is array/object
 *
 * Async methods (check_key, parser.mass):
 *   - POST to .new → read the per-method ID field → poll via per-method poll method.
 *   - check_key : .new returns task_id, polls check_key.get?task_id=N
 *   - parser.mass: .new returns id,      polls parser.mass.id?mass_id=N
 */
export async function executeMutagenMethod(
  method: string,
  params: Record<string, unknown> = {},
  pollTimeoutSec = 60,
): Promise<unknown> {
  const token = getApiKey();
  const asyncConfig = ASYNC_CONFIG[method];

  if (!asyncConfig) {
    // Synchronous method
    if (shouldUsePost(method, params)) {
      const url = `${BASE_URL}/${token}/mutagen.${method}/`;
      const res = await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(params),
      });
      return res.data;
    } else {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        qs.set(k, String(v));
      }
      const qsPart = qs.toString() ? "?" + qs.toString() : "";
      const url = `${BASE_URL}/${token}/mutagen.${method}/${qsPart}`;
      const res = await request(url);
      return res.data;
    }
  }

  // Async method: POST to .new, then poll
  const startUrl = `${BASE_URL}/${token}/mutagen.${method}.new/`;
  const startRes = await request(startUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(params),
  });
  const startData = startRes.data as Record<string, unknown>;
  const taskId = startData?.[asyncConfig.newField];
  if (taskId === undefined || taskId === null) {
    throw new Error(
      `Mutagen ${method}.new: missing '${asyncConfig.newField}' in response: ${JSON.stringify(startData)}`,
    );
  }

  const deadline = Date.now() + pollTimeoutSec * 1000;
  let delay = 2000;
  const maxDelay = 30_000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, maxDelay);

    const pollUrl = `${BASE_URL}/${token}/mutagen.${asyncConfig.pollMethod}/?${asyncConfig.pollParam}=${taskId}`;
    const pollRes = await request(pollUrl);
    const d = pollRes.data as Record<string, unknown>;
    const status = d?.["status"] as string | undefined;

    if (asyncConfig.terminalSuccess.includes(status ?? "")) return d;
    if (asyncConfig.terminalFail.includes(status ?? "")) {
      throw new Error(`Mutagen ${method} task ${taskId} terminal status: ${status}`);
    }
    // pending statuses → keep polling
  }

  throw new Error(`Mutagen ${method} task ${taskId} timed out after ${pollTimeoutSec}s`);
}

export async function getBalance(): Promise<number> {
  const url = `${BASE_URL}/${getApiKey()}/mutagen.balance/`;
  const res = await request(url);
  const data = res.data as Record<string, unknown>;
  return Number(data?.["balance"] ?? 0);
}

interface CheckKeyResult {
  strong: number;
  wordstat: number;
  tails: number;
  direct: { spec: number; first: number; garant: number };
}

interface MutagenStartResponse {
  task_id?: string;
  status?: string;
}

interface MutagenDirectCosts {
  spec?: number;
  first?: number;
  garant?: number;
}

interface MutagenCheckResponse {
  status?: string;
  strong?: number;
  wordstat?: number;
  tails?: number;
  direct?: MutagenDirectCosts;
}

async function checkKeyAsync(phrase: string, pollTimeoutSec: number): Promise<CheckKeyResult> {
  const token = getApiKey();
  // 1. start the task
  const startUrl = `${BASE_URL}/${token}/mutagen.check_key.new/?key=${encodeURIComponent(phrase)}`;
  const startRes = await request(startUrl, { method: "POST" });
  const startData = startRes.data as MutagenStartResponse;
  const taskId = startData?.task_id;
  if (!taskId) throw new Error(`Mutagen check_key.new: missing task_id for phrase "${phrase}"`);

  // 2. poll until completed
  const deadline = Date.now() + pollTimeoutSec * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const getUrl = `${BASE_URL}/${token}/mutagen.check_key.get/?task_id=${taskId}`;
    const pollRes = await request(getUrl);
    const d = pollRes.data as MutagenCheckResponse;
    if (d?.status === "completed") {
      return {
        strong: Number(d.strong ?? 0),
        wordstat: Number(d.wordstat ?? 0),
        tails: Number(d.tails ?? 0),
        direct: {
          spec: Number(d.direct?.spec ?? 0),
          first: Number(d.direct?.first ?? 0),
          garant: Number(d.direct?.garant ?? 0),
        },
      };
    }
  }
  throw new Error(`Mutagen check_key timeout for phrase "${phrase}" after ${pollTimeoutSec}s`);
}

export async function getCompetition(p: {
  phrases: string[];
  pollTimeoutSec: number;
}): Promise<{
  phrases: Array<{ phrase: string; competition: number; wordstat: number; tails: number; cost_spec: number; cost_first: number; cost_garant: number }>;
  balance_left: number;
}> {
  // sequential to keep costs/billing predictable
  const results = [];
  for (const phrase of p.phrases) {
    const r = await checkKeyAsync(phrase, p.pollTimeoutSec);
    results.push({
      phrase,
      competition: r.strong,
      wordstat: r.wordstat,
      tails: r.tails,
      cost_spec: r.direct.spec,
      cost_first: r.direct.first,
      cost_garant: r.direct.garant,
    });
  }
  let balanceLeft = -1;
  try {
    balanceLeft = await getBalance();
  } catch (_) {
    // best-effort: balance check is informational
  }
  return { phrases: results, balance_left: balanceLeft };
}
