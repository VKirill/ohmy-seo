import fs from "node:fs/promises";
import path from "node:path";
import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

const MAX_SIZE_BYTES = 100 * 1024 * 1024;
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".qt", ".flv", ".avi"]);

/** Poll AdVideos conversion. Tests may set delayMs to 0. */
export const adVideoPoll = { attempts: 12, delayMs: 5000 };

const InputSchema = z
  .object({
    url: z.string().url().optional().describe("Public video URL — Direct fetches it (MP4/WebM/MOV/AVI, 5–60 s, ≤100 MB)"),
    file_path: z.string().optional().describe("Absolute path to a local video file (≤100 MB)"),
    base64: z.string().optional().describe("Base64-encoded video (≤100 MB decoded)"),
    video_id: z.string().min(1).optional().describe("Existing AdVideos Id — skip upload, wait for READY and create VideoExtension creative"),
    name: z.string().min(1).max(255).optional().describe("AdVideos Name (≤255). Required by API for binary upload; generated if omitted."),
    account: z.string().optional().describe("Account label from list_accounts (optional if a default account is configured)"),
    client_login: z.string().optional().describe("Yandex Direct agency client login for sub-client access (optional)"),
  })
  .refine(
    (d) => [d.url, d.file_path, d.base64, d.video_id].filter(Boolean).length === 1,
    { message: "Exactly one of url, file_path, base64, or video_id must be provided" },
  );

type DirectCall = Awaited<ReturnType<typeof executeApiCall>>;

function text(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function addItem(data: unknown): Record<string, unknown> | undefined {
  return ((data as { result?: { AddResults?: Array<Record<string, unknown>> } })?.result?.AddResults)?.[0];
}

function topError(data: unknown): unknown {
  return (data as { error?: unknown })?.error;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

async function direct(opts: {
  endpoint: string;
  body: unknown;
  account?: string;
  client_login?: string;
}): Promise<DirectCall> {
  return executeApiCall({
    apiName: "direct",
    endpoint: opts.endpoint,
    method: "POST",
    body: opts.body,
    account: opts.account,
    client_login: opts.client_login,
  });
}

export async function runDirectUploadVideo(input: z.infer<typeof InputSchema>) {
  const parsed = InputSchema.parse(input);

  try {
    let videoId = parsed.video_id;

    if (!videoId) {
      const name = parsed.name ?? `vid-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
      const item: Record<string, string> = { Name: name };

      if (parsed.url) {
        item.Url = parsed.url;
      } else if (parsed.file_path) {
        const ext = path.extname(parsed.file_path).toLowerCase();
        if (!VIDEO_EXTS.has(ext)) {
          return text({ error: `Unsupported file extension: ${ext}. Use .mp4, .webm, .mov, .qt, .flv, or .avi.` });
        }
        const buf = await fs.readFile(parsed.file_path);
        if (buf.length > MAX_SIZE_BYTES) {
          return text({ error: `Video size ${buf.length} bytes exceeds 100 MB limit` });
        }
        item.VideoData = buf.toString("base64");
      } else {
        const buf = Buffer.from(parsed.base64!, "base64");
        if (buf.length > MAX_SIZE_BYTES) {
          return text({ error: `Decoded video size ${buf.length} bytes exceeds 100 MB limit` });
        }
        item.VideoData = parsed.base64!;
      }

      const uploaded = await direct({
        endpoint: "/json/v5/advideos",
        body: { method: "add", params: { AdVideos: [item] } },
        account: parsed.account,
        client_login: parsed.client_login,
      });
      if (!uploaded.ok) return text({ error: "AdVideos.add failed", details: uploaded.body });
      const err = topError(uploaded.data);
      if (err) return text({ error: "AdVideos.add failed", details: err });
      const add = addItem(uploaded.data);
      const itemErrors = add?.Errors;
      if (itemErrors) return text({ error: "AdVideos.add failed", errors: itemErrors });
      const id = add?.Id;
      if (typeof id !== "string" || id.length === 0) {
        return text({ error: "AdVideos.add returned no Id", details: uploaded.data });
      }
      videoId = id;
    }

    let status: string | undefined;
    for (let i = 0; i < adVideoPoll.attempts; i++) {
      if (i > 0) await sleep(adVideoPoll.delayMs);
      const got = await direct({
        endpoint: "/json/v5/advideos",
        body: {
          method: "get",
          params: {
            SelectionCriteria: { Ids: [videoId] },
            FieldNames: ["Id", "Status"],
            Page: { Limit: 10, Offset: 0 },
          },
        },
        account: parsed.account,
        client_login: parsed.client_login,
      });
      if (!got.ok) return text({ error: "AdVideos.get failed", video_id: videoId, details: got.body });
      const err = topError(got.data);
      if (err) return text({ error: "AdVideos.get failed", video_id: videoId, details: err });
      const row = ((got.data as { result?: { AdVideos?: Array<{ Id?: string; Status?: string }> } })?.result?.AdVideos)?.[0];
      status = row?.Status;
      if (status === "ERROR") return text({ error: "Video conversion failed", video_id: videoId, video_status: status });
      if (status === "READY") break;
    }

    if (status !== "READY") {
      return text({
        video_id: videoId,
        creative_id: null,
        video_status: status ?? "UNKNOWN",
        retry: "Video is still converting. Call yandex_direct_upload_video again with this video_id.",
      });
    }

    let lastCreativeErrors: unknown;
    for (let i = 0; i < 3; i++) {
      if (i > 0) await sleep(adVideoPoll.delayMs);
      const created = await direct({
        endpoint: "/json/v5/creatives",
        body: { method: "add", params: { Creatives: [{ VideoExtensionCreative: { VideoId: videoId } }] } },
        account: parsed.account,
        client_login: parsed.client_login,
      });
      if (!created.ok) return text({ error: "Creatives.add failed", video_id: videoId, details: created.body });
      const err = topError(created.data);
      if (err) return text({ error: "Creatives.add failed", video_id: videoId, details: err });
      const add = addItem(created.data);
      const itemErrors = add?.Errors;
      if (!itemErrors) {
        const creativeId = add?.Id;
        if (typeof creativeId !== "number" && typeof creativeId !== "string") {
          return text({ error: "Creatives.add returned no Id", video_id: videoId, details: created.data });
        }
        const asNumber = typeof creativeId === "number" ? creativeId : Number(creativeId);
        return text({
          video_id: videoId,
          creative_id: Number.isSafeInteger(asNumber) ? asNumber : creativeId,
          video_status: "READY",
        });
      }
      lastCreativeErrors = itemErrors;
    }

    return text({
      error: "Creatives.add failed after retries — video may still be processing",
      video_id: videoId,
      video_status: "READY",
      errors: lastCreativeErrors,
      retry: "Call yandex_direct_upload_video again with this video_id.",
    });
  } catch (e) {
    return errorToMcpContent(e);
  }
}
