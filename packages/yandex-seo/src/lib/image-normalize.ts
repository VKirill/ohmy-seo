import { Jimp } from "jimp";

export type NormalizeAdImageResult =
  | { action: "asis" }
  | { action: "resized"; base64: string; format: "PNG"; width: number; height: number }
  | { action: "skip"; reason: string };

/**
 * Classify and optionally resize an image for Yandex AdImages:
 *   - ~1:1 (|ratio - 1| <= 0.05)  → asis
 *   - landscape ≥ 1.5:1            → resize to exact 16:9 (1920x1080), return base64 PNG
 *   - anything else (vertical etc) → skip with reason
 */
export async function normalizeAdImage(filePath: string): Promise<NormalizeAdImageResult> {
  const img = await Jimp.read(filePath);
  const width = img.width;
  const height = img.height;
  const ratio = width / height;

  if (Math.abs(ratio - 1) <= 0.05) {
    return { action: "asis" };
  }

  if (ratio >= 1.5) {
    const resized = img.resize({ w: 1920, h: 1080 });
    const buf = await resized.getBuffer("image/png");
    const base64 = buf.toString("base64");
    return { action: "resized", base64, format: "PNG", width: 1920, height: 1080 };
  }

  return {
    action: "skip",
    reason: `unsupported aspect ratio ${ratio.toFixed(4)} (Yandex accepts only 1:1 and 16:9)`,
  };
}
