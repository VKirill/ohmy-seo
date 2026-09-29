// Big-int-safe JSON parsing for API responses.
//
// Yandex Direct returns ad Ids larger than Number.MAX_SAFE_INTEGER (2^53-1),
// e.g. 1914841739704982433. The stock JSON.parse / Response.json() silently
// rounds them, so a later delete/moderate/dedup by that Id targets the wrong
// object or 404s. This parser quotes integer literals that exceed the safe
// range BEFORE parsing, so they survive as exact strings. Integers within the
// safe range (campaign/group/keyword Ids, ~9-13 digits) stay numbers, keeping
// the blast radius to genuinely-unsafe values only.

const MAX_SAFE = 9007199254740991n; // 2^53 - 1
const MIN_SAFE = -9007199254740991n;

/**
 * Wrap every out-of-string integer literal whose magnitude exceeds
 * Number.MAX_SAFE_INTEGER in double quotes, leaving everything else untouched.
 * Strings (incl. escaped quotes) and fractional/exponent numbers are preserved.
 */
export function quoteUnsafeIntegers(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  let inStr = false;

  while (i < n) {
    const c = text[i];

    if (inStr) {
      out += c;
      if (c === "\\") {
        // escape sequence: copy the next char verbatim so an escaped quote
        // does not end the string.
        i++;
        if (i < n) out += text[i];
      } else if (c === '"') {
        inStr = false;
      }
      i++;
      continue;
    }

    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }

    // Outside a string, digits and a leading '-' can only start a JSON number.
    // Scan the WHOLE number — integer part, fraction and exponent — in one go.
    // Scanning only the integer part used to leave the fractional digits to be
    // re-scanned as a separate token, and a long fraction such as
    // 0.018604651162790697 got quoted as 0."018604651162790697", which is not
    // valid JSON.
    if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i;
      if (text[j] === "-") j++;
      const digitsStart = j;
      while (j < n && text[j]! >= "0" && text[j]! <= "9") j++;
      const intDigits = j - digitsStart;

      let isPureInt = true;

      if (text[j] === ".") {
        isPureInt = false;
        j++;
        while (j < n && text[j]! >= "0" && text[j]! <= "9") j++;
      }

      if (text[j] === "e" || text[j] === "E") {
        isPureInt = false;
        j++;
        if (text[j] === "+" || text[j] === "-") j++;
        while (j < n && text[j]! >= "0" && text[j]! <= "9") j++;
      }

      const token = text.slice(i, j);

      if (isPureInt && intDigits >= 16) {
        let unsafe = false;
        try {
          const v = BigInt(token);
          unsafe = v > MAX_SAFE || v < MIN_SAFE;
        } catch {
          unsafe = false;
        }
        if (unsafe) {
          out += '"' + token + '"';
          i = j;
          continue;
        }
      }

      out += token;
      i = j;
      continue;
    }


    out += c;
    i++;
  }

  return out;
}

/** JSON.parse that preserves out-of-safe-range integers as exact strings. */
export function parseJsonSafe(text: string): unknown {
  return JSON.parse(quoteUnsafeIntegers(text));
}
