import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getMasterKey } from "./master-key.js";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_BLOB_BYTES = IV_BYTES + TAG_BYTES;
const ALGORITHM = "aes-256-gcm";

export function encryptSecret(plain: string): Buffer {
  const key = getMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]);
}

export function decryptSecret(blob: Buffer): string {
  if (blob.length < MIN_BLOB_BYTES) {
    throw new Error("encrypted blob too short");
  }
  const key = getMasterKey();
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const enc = encryptSecret("hello-секрет");
  const dec = decryptSecret(enc);
  console.log(dec === "hello-секрет" ? "OK roundtrip" : "FAIL"); // guardian: allow
  const enc2 = encryptSecret("hello-секрет");
  console.log(enc.equals(enc2) ? "FAIL: same ciphertext twice (IV not random)" : "OK random IV"); // guardian: allow
}
