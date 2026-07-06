/**
 * Direct API payload builder — internal helpers.
 *
 * These are shared implementation helpers for the payload builders. They are NOT
 * part of the public API of payload-builder — they are exported only so sibling
 * modules under payloads/ can import them.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Compute current date in Moscow time (UTC+3). Addresses quirk 4. */
export function getMoscowDate(): string {
  const now = new Date();
  const mskOffset = 3 * 60 * 60 * 1000; // UTC+3 in milliseconds
  const msk = new Date(now.getTime() + mskOffset);
  return msk.toISOString().slice(0, 10); // YYYY-MM-DD, MSK
}

/** Generate a short random hex string for unique name suffixes. Addresses quirk 3. */
export function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  // Use Math.random as crypto is not needed for uniqueness here
  for (let i = 0; i < bytes; i++) {
    arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
