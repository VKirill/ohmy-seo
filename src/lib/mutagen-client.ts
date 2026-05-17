import { request } from "./http.js";

const BASE_URL = "http://api.mutagen.ru/json";

function getApiKey(): string {
  const k = process.env.MUTAGEN_API_KEY;
  if (!k) throw new Error("MUTAGEN_API_KEY is required for mutagen_competition tool");
  return k;
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
