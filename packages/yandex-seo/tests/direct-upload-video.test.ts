import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockExecuteApiCall = vi.fn();

vi.mock("../src/lib/api-gateway.js", () => ({
  executeApiCall: (...args: unknown[]) => mockExecuteApiCall(...args),
}));

vi.mock("@ohmy-seo/mcp-core/errors", () => ({
  errorToMcpContent: (e: unknown) => ({
    content: [{ type: "text", text: String(e) }],
  }),
}));

import { adVideoPoll, runDirectUploadVideo } from "../src/tools/direct-upload-video.js";

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

const VIDEO_ID = "6ab6a59cd3856b50316563d2005";
const CREATIVE_ID = 1165964908;

function okAdd(id: string | number) {
  return { ok: true, status: 200, data: { result: { AddResults: [{ Id: id }] } } };
}

function okGet(status: string) {
  return { ok: true, status: 200, data: { result: { AdVideos: [{ Id: VIDEO_ID, Status: status }] } } };
}

describe("runDirectUploadVideo", () => {
  const prev = { ...adVideoPoll };

  beforeEach(() => {
    mockExecuteApiCall.mockReset();
    adVideoPoll.attempts = 3;
    adVideoPoll.delayMs = 0;
  });

  afterEach(() => {
    adVideoPoll.attempts = prev.attempts;
    adVideoPoll.delayMs = prev.delayMs;
  });

  it("uploads by URL, waits for READY, creates VideoExtension creative", async () => {
    mockExecuteApiCall
      .mockResolvedValueOnce(okAdd(VIDEO_ID))
      .mockResolvedValueOnce(okGet("READY"))
      .mockResolvedValueOnce(okAdd(CREATIVE_ID));

    const out = parse(
      await runDirectUploadVideo({ url: "https://cdn.example/clip.mp4", name: "clip-16x9" }),
    );
    expect(out).toEqual({ video_id: VIDEO_ID, creative_id: CREATIVE_ID, video_status: "READY" });

    const addBody = mockExecuteApiCall.mock.calls[0][0].body;
    expect(addBody).toEqual({
      method: "add",
      params: { AdVideos: [{ Name: "clip-16x9", Url: "https://cdn.example/clip.mp4" }] },
    });
    expect(mockExecuteApiCall.mock.calls[0][0].endpoint).toBe("/json/v5/advideos");
    expect(mockExecuteApiCall.mock.calls[2][0].endpoint).toBe("/json/v5/creatives");
    expect(mockExecuteApiCall.mock.calls[2][0].body).toEqual({
      method: "add",
      params: { Creatives: [{ VideoExtensionCreative: { VideoId: VIDEO_ID } }] },
    });
  });

  it("resumes from video_id without calling AdVideos.add", async () => {
    mockExecuteApiCall.mockResolvedValueOnce(okGet("READY")).mockResolvedValueOnce(okAdd(CREATIVE_ID));
    const out = parse(await runDirectUploadVideo({ video_id: VIDEO_ID }));
    expect(out.creative_id).toBe(CREATIVE_ID);
    expect(mockExecuteApiCall.mock.calls.map((c) => c[0].endpoint)).toEqual([
      "/json/v5/advideos",
      "/json/v5/creatives",
    ]);
    expect(mockExecuteApiCall.mock.calls[0][0].body.method).toBe("get");
  });

  it("returns retry payload while still converting", async () => {
    mockExecuteApiCall.mockResolvedValue(okGet("CONVERTING"));
    const out = parse(await runDirectUploadVideo({ video_id: VIDEO_ID }));
    expect(out.creative_id).toBeNull();
    expect(out.video_status).toBe("CONVERTING");
    expect(String(out.retry)).toContain("video_id");
    expect(mockExecuteApiCall.mock.calls.every((c) => c[0].body.method === "get")).toBe(true);
  });

  it("fails when conversion status is ERROR", async () => {
    mockExecuteApiCall.mockResolvedValueOnce(okGet("ERROR"));
    const out = parse(await runDirectUploadVideo({ video_id: VIDEO_ID }));
    expect(out.error).toBe("Video conversion failed");
    expect(out.video_id).toBe(VIDEO_ID);
  });

  it("rejects providing both url and video_id", async () => {
    await expect(
      runDirectUploadVideo({ url: "https://cdn.example/clip.mp4", video_id: VIDEO_ID }),
    ).rejects.toThrow(/Exactly one/);
  });
});
