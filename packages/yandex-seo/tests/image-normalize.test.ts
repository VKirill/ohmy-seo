import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Jimp } from "jimp";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeAdImage } from "../src/lib/image-normalize.js";

/** Write a solid-colour PNG at the given path and return the path. */
async function writePng(filePath: string, width: number, height: number): Promise<string> {
  const img = new Jimp({ width, height, color: 0xff0000ff });
  const buf = await img.getBuffer("image/png");
  await fs.writeFile(filePath, buf);
  return filePath;
}

const tmpDir = path.join(os.tmpdir(), `jimp-normalize-test-${process.pid}`);

beforeAll(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("normalizeAdImage", () => {
  it("returns asis for exact 1:1 image (1024x1024)", async () => {
    const p = await writePng(path.join(tmpDir, "square.png"), 1024, 1024);
    const result = await normalizeAdImage(p);
    expect(result.action).toBe("asis");
  });

  it("returns asis for near-1:1 image within ±5% tolerance (100x98)", async () => {
    const p = await writePng(path.join(tmpDir, "near-square.png"), 100, 98);
    const result = await normalizeAdImage(p);
    expect(result.action).toBe("asis");
  });

  it("returns resized 1920x1080 for near-16:9 landscape (1376x768)", async () => {
    const p = await writePng(path.join(tmpDir, "landscape.png"), 1376, 768);
    const result = await normalizeAdImage(p);
    expect(result.action).toBe("resized");
    if (result.action === "resized") {
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.format).toBe("PNG");
      expect(typeof result.base64).toBe("string");
      expect(result.base64.length).toBeGreaterThan(0);

      // Verify the base64 actually decodes to a 1920x1080 PNG
      const buf = Buffer.from(result.base64, "base64");
      const decoded = await Jimp.fromBuffer(buf);
      expect(decoded.width).toBe(1920);
      expect(decoded.height).toBe(1080);
    }
  });

  it("returns resized 1920x1080 for exact 16:9 (1920x1080)", async () => {
    const p = await writePng(path.join(tmpDir, "exact-169.png"), 1920, 1080);
    const result = await normalizeAdImage(p);
    expect(result.action).toBe("resized");
    if (result.action === "resized") {
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
    }
  });

  it("returns skip for vertical 9:16 image (768x1376)", async () => {
    const p = await writePng(path.join(tmpDir, "vertical.png"), 768, 1376);
    const result = await normalizeAdImage(p);
    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.reason).toContain("unsupported aspect ratio");
      expect(result.reason).toContain("Yandex accepts only 1:1 and 16:9");
    }
  });

  it("returns skip for portrait image (768x1024)", async () => {
    const p = await writePng(path.join(tmpDir, "portrait.png"), 768, 1024);
    const result = await normalizeAdImage(p);
    expect(result.action).toBe("skip");
  });
});
