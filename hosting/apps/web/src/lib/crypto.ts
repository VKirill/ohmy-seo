import { readFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGORITHM = "aes-256-gcm";

/**
 * Wire format is byte-identical to @ohmy-seo/mcp-core secret-cipher:
 * iv(12) || ciphertext || tag(16). The gateway re-encrypts under a
 * per-tenant key before handing a SQLite file to an MCP server, so the
 * two sides must agree on this layout exactly.
 */
function masterKey(): Buffer {
  const raw = process.env.OHMY_SEO_MASTER_KEY_FILE
    ? readFileSync(process.env.OHMY_SEO_MASTER_KEY_FILE, "utf8").trim()
    : process.env.OHMY_SEO_MASTER_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("OHMY_SEO_MASTER_KEY missing or invalid (need 64 hex chars)");
  }
  return Buffer.from(raw, "hex");
}

export function encryptSecret(plain: string, key: Buffer = masterKey()): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]);
}

export function decryptSecret(blob: Buffer, key: Buffer = masterKey()): string {
  if (blob.length < IV_BYTES + TAG_BYTES) throw new Error("encrypted blob too short");
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ct = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
  const d = createDecipheriv(ALGORITHM, key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

export function newApiKey(): { plain: string; hash: string; prefix: string } {
  const body = randomBytes(24).toString("base64url");
  const plain = `ohmy_${body}`;
  return { plain, hash: hashApiKey(plain), prefix: plain.slice(0, 12) };
}

export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
