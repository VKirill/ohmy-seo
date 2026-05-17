import { request } from "./http.js";

const BASE_URL_PROD = "https://api.direct.yandex.com/json/v5";
const BASE_URL_SANDBOX = "https://api-sandbox.direct.yandex.com/json/v5";

function getBaseUrl(): string {
  return process.env.DIRECT_USE_SANDBOX === "true" ? BASE_URL_SANDBOX : BASE_URL_PROD;
}

async function callDirect(accessToken: string, clientLogin: string | undefined, method: string, params: unknown): Promise<unknown> {
  const url = `${getBaseUrl()}/wordstat`;
  const headers: Record<string, string> = {
    Authorization: "Bearer " + accessToken,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (clientLogin) headers["Client-Login"] = clientLogin;
  const res = await request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ method, params }),
  });
  return res.data;
}

export interface WordstatPhraseRow {
  phrase: string;
  total_shows: number;
  related: Array<{ phrase: string; shows: number }>;
}

export async function wordstatKeywords(p: {
  accessToken: string;
  clientLogin?: string;
  phrases: string[];
  geoIds?: number[];
  pollTimeoutSec: number;
}): Promise<{ phrases: WordstatPhraseRow[]; report_id: number }> {
  const createRes = await callDirect(p.accessToken, p.clientLogin, "CreateNewWordstatReport", {
    Phrases: p.phrases,
    ...(p.geoIds && p.geoIds.length > 0 ? { GeoID: p.geoIds } : {}),
  }) as Record<string, unknown>;

  const reportId = createRes["data"];
  if (typeof reportId !== "number") {
    throw new Error("Direct CreateNewWordstatReport: unexpected response shape");
  }

  try {
    const deadline = Date.now() + p.pollTimeoutSec * 1000;
    let report: unknown[] | null = null;

    while (Date.now() < deadline) {
      await new Promise<void>(r => setTimeout(r, 5000));
      try {
        const getRes = await callDirect(p.accessToken, p.clientLogin, "GetWordstatReport", { ReportID: reportId }) as Record<string, unknown>;
        if (Array.isArray(getRes["data"])) {
          report = getRes["data"] as unknown[];
          break;
        }
      } catch (err: unknown) {
        // If API returns error indicating report is not ready yet — continue polling.
        const errObj = err as Record<string, unknown> | null;
        const body = typeof errObj?.["body"] === "string" ? errObj["body"] : "";
        if (/pending|not.{0,3}ready|status.{0,3}1/i.test(body)) {
          continue;
        }
        throw err;
      }
    }

    if (!report) {
      throw new Error(`Direct Wordstat report ${reportId} timed out after ${p.pollTimeoutSec}s`);
    }

    const phrases: WordstatPhraseRow[] = report.map((row: unknown) => {
      const r = row as Record<string, unknown>;
      const includingPhrases = Array.isArray(r["SearchedWith"]) ? r["SearchedWith"] as Array<Record<string, unknown>> : [];
      const totalShows = includingPhrases.reduce((s: number, x: Record<string, unknown>) => s + (typeof x["Shows"] === "number" ? x["Shows"] : 0), 0);
      const searchedAlso = Array.isArray(r["SearchedAlso"]) ? r["SearchedAlso"] as Array<Record<string, unknown>> : [];
      const related = [...includingPhrases, ...searchedAlso]
        .map((x: Record<string, unknown>) => ({ phrase: String(x["Phrase"] ?? ""), shows: Number(x["Shows"] ?? 0) }))
        .sort((a, b) => b.shows - a.shows)
        .slice(0, 50);
      return { phrase: String(r["Phrase"] ?? ""), total_shows: totalShows, related };
    });

    return { phrases, report_id: reportId };
  } finally {
    try {
      await callDirect(p.accessToken, p.clientLogin, "DeleteWordstatReport", { ReportID: reportId });
    } catch (e) {
      // best-effort cleanup; not fatal
      console.error("warn: failed to DeleteWordstatReport", reportId);
    }
  }
}
