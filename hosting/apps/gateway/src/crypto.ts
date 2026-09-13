import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const IV = 12;
const TAG = 16;
const ALG = "aes-256-gcm";

/** Byte-identical to @ohmy-seo/mcp-core: iv(12) || ciphertext || tag(16). */
export function encryptWith(key: Buffer, plain: string): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]);
}

export function decryptWith(key: Buffer, blob: Buffer): string {
  const iv = blob.subarray(0, IV);
  const tag = blob.subarray(blob.length - TAG);
  const ct = blob.subarray(IV, blob.length - TAG);
  const d = createDecipheriv(ALG, key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

export function platformKey(): Buffer {
  const raw = process.env.OHMY_SEO_MASTER_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("OHMY_SEO_MASTER_KEY invalid");
  return Buffer.from(raw, "hex");
}

/**
 * Per-tenant key derived from the platform key, so tenant databases are not
 * interchangeable and no extra secret has to be persisted per user.
 */
export function tenantKey(userId: number): Buffer {
  return createHash("sha256").update(platformKey()).update(`tenant:${userId}`).digest();
}

export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}
