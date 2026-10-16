// Cisco "type 7" passwords are a reversible XOR scramble with a published key,
// which is why the game teaches that `service password-encryption` is weak.
const XLAT = "dsfd;kfoA,.iyewrkldJKDHSUBsgvca69834ncxv9873254k;fg87";

export function type7Encode(plain: string): string {
  let sum = 0;
  for (const ch of plain) sum += ch.charCodeAt(0);
  const salt = sum % 16;
  let out = String(salt).padStart(2, "0");
  for (let i = 0; i < plain.length; i++) {
    const v = plain.charCodeAt(i) ^ XLAT.charCodeAt((salt + i) % XLAT.length);
    out += v.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function type7Decode(encoded: string): string {
  const salt = Number(encoded.slice(0, 2));
  let out = "";
  for (let i = 2, n = 0; i < encoded.length; i += 2, n++) {
    out += String.fromCharCode(parseInt(encoded.slice(i, i + 2), 16) ^ XLAT.charCodeAt((salt + n) % XLAT.length));
  }
  return out;
}

const ALPHABET = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Stand-in for the MD5-crypt "type 5" hash IOS uses for `enable secret`.
 * It looks like `$1$salt$hash` and is one-way enough for a game, but it is not real MD5-crypt.
 */
export function type5Hash(plain: string, salt?: string): string {
  const s = salt ?? saltFor(plain);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const input = s + "$" + plain;
  let out = "";
  for (let round = 0; out.length < 22; round++) {
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i) + round;
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + c, 0x5bd1e995) >>> 0;
    }
    out += ALPHABET[h1 & 63] + ALPHABET[(h1 >>> 6) & 63] + ALPHABET[h2 & 63] + ALPHABET[(h2 >>> 6) & 63];
  }
  return `$1$${s}$${out.slice(0, 22)}`;
}

export function type5Verify(plain: string, hash: string): boolean {
  const salt = hash.split("$")[2];
  return type5Hash(plain, salt) === hash;
}

function saltFor(plain: string): string {
  let h = 7;
  for (const ch of plain) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return [0, 6, 12, 18].map((shift) => ALPHABET[(h >>> shift) & 63]).join("");
}
