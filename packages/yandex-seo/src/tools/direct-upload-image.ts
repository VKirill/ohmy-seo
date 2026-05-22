import fs from "node:fs/promises";
import path from "node:path";
import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const InputSchema = z
  .object({
    url: z.string().url().optional().describe("Public image URL to fetch and upload (JPEG or PNG, ≤ 10 MB)"),
    file_path: z.string().optional().describe("Absolute path to a local image file (JPEG or PNG, ≤ 10 MB)"),
    base64: z.string().optional().describe("Base64-encoded image data (JPEG or PNG, ≤ 10 MB decoded)"),
    account: z.string().optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  })
  .refine(
    (d) => [d.url, d.file_path, d.base64].filter(Boolean).length === 1,
    { message: "Exactly one of url, file_path, or base64 must be provided" },
  );

function extToMime(ext: string): "image/jpeg" | "image/png" | null {
  const lower = ext.toLowerCase();
  if (lower === ".jpg" || lower === ".jpeg") return "image/jpeg";
  if (lower === ".png") return "image/png";
  return null;
}

function mimeToFormat(mime: string): "jpg" | "png" {
  return mime === "image/png" ? "png" : "jpg";
}

export async function runDirectUploadImage(input: z.infer<typeof InputSchema>) {
  const parsed = InputSchema.parse(input);

  let imageBuffer: Buffer;
  let format: "jpg" | "png";
  let originalUrl: string | undefined;

  try {
    if (parsed.url) {
      originalUrl = parsed.url;
      const response = await fetch(parsed.url);
      if (!response.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Failed to fetch URL: HTTP ${response.status}` }),
            },
          ],
        };
      }

      const contentType = response.headers.get("content-type") ?? "";
      const mimeBase = contentType.split(";")[0].trim();
      if (mimeBase !== "image/jpeg" && mimeBase !== "image/png") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Unsupported content-type: ${mimeBase}. Only image/jpeg and image/png are accepted.`,
              }),
            },
          ],
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuffer);

      if (imageBuffer.length > MAX_SIZE_BYTES) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Image size ${imageBuffer.length} bytes exceeds 10 MB limit` }),
            },
          ],
        };
      }

      format = mimeToFormat(mimeBase);
    } else if (parsed.file_path) {
      const ext = path.extname(parsed.file_path);
      const mime = extToMime(ext);
      if (!mime) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Unsupported file extension: ${ext}. Only .jpg, .jpeg, and .png are accepted.`,
              }),
            },
          ],
        };
      }

      imageBuffer = await fs.readFile(parsed.file_path);

      if (imageBuffer.length > MAX_SIZE_BYTES) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Image size ${imageBuffer.length} bytes exceeds 10 MB limit` }),
            },
          ],
        };
      }

      format = mimeToFormat(mime);
    } else {
      // base64 branch
      imageBuffer = Buffer.from(parsed.base64!, "base64");

      if (imageBuffer.length > MAX_SIZE_BYTES) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Decoded image size ${imageBuffer.length} bytes exceeds 10 MB limit` }),
            },
          ],
        };
      }

      // Detect format from magic bytes: PNG starts with \x89PNG, JPEG with \xFF\xD8
      if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) {
        format = "png";
      } else if (imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8) {
        format = "jpg";
      } else {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Cannot detect image format from base64 data. Only JPEG and PNG are supported." }),
            },
          ],
        };
      }
    }

    const imageData = imageBuffer.toString("base64");

    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/adimages",
      method: "POST",
      body: {
        method: "add",
        params: {
          AdImages: [{ ImageData: imageData }],
        },
      },
      account: parsed.account,
    });

    if (!result.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Yandex Direct API error", details: result.body }),
          },
        ],
      };
    }

    const data = result.data as Record<string, unknown>;
    const addResults = (data?.result as Record<string, unknown>)?.AddResults as Array<Record<string, unknown>> | undefined;
    const adImageHash = addResults?.[0]?.AdImageHash as string | undefined;

    const output: Record<string, unknown> = {
      ad_image_hash: adImageHash ?? null,
      format,
      size_bytes: imageBuffer.length,
    };

    if (originalUrl) {
      output.original_url = originalUrl;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(output, null, 2),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
