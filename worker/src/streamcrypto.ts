/**
 * movy.sx stream crypto — faithful TypeScript port of the site's client routine.
 *
 * The original also contains a dead branch that would fill the remaining state slots
 * from a truncated SHA-256 constant table; it is unreachable because
 * `(length * (length + 1)) & 1` is always 0 for any integer length. Slots therefore
 * stay holes, which `keystream` already accounts for.
 *
 * Reverse-engineered from the Next.js chunk that ships the source fetcher:
 *   GET {base}/seed?mediaId=<tmdbId>          -> { seed, ttlMs }
 *   GET {base}/<city>/sources?....&enc=2&seed=<seed> -> base64url(nonce || keystream^payload)
 *
 * The ciphertext is: 4 magic bytes ("mvm1") followed by the XOR of the UTF-8 JSON
 * with a keystream produced by a small Murmur3/FNV-flavoured PRNG over a 61-slot
 * state array. Two details matter for byte-exactness and are easy to get wrong:
 *
 *  1. The state array is *sparse* (`new Array(61)`), never filled. Whether a slot
 *     has been written decides how the accumulator is mixed, so a filled array
 *     decrypts garbage. We keep `undefined` holes and test for them.
 *  2. `Math.imul` / `>>> 0` semantics are relied on throughout; every intermediate
 *     is coerced back to uint32 exactly where the original does.
 */

/** "mvm1" — plaintext prefix proving the seed and payload were valid. */
const MAGIC = [109, 118, 109, 49];

/** Rotate left, matching `e>>>0` + `e<<a | e>>>32-a`. */
function rotl(value: number, amount: number): number {
  const e = value >>> 0;
  const a = amount & 31;
  if (a === 0) return e >>> 0;
  return ((e << a) | (e >>> (32 - a))) >>> 0;
}

/** MurmurHash3 fmix32 finalizer. */
function avalanche(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** FNV-1a over UTF-16 code units, as the original's `charCodeAt` loop. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 0x1000193) >>> 0;
  }
  return hash >>> 0;
}

export interface CryptoState {
  /** 61 slots; `undefined` means the slot was never written (a JS array hole). */
  slots: (number | undefined)[];
  acc: number;
}

/** Build the initial 61-slot state from the seed string and the media id. */
export function initState(seed: string, mediaId: number): CryptoState {
  let n = avalanche((avalanche(fnv1a(seed)) ^ avalanche((mediaId >>> 0) ^ 0x9e3779b9)) >>> 0);
  // Deliberately not filled: holes must stay holes.
  const slots: (number | undefined)[] = new Array(61);
  for (let i = 0; i < 8; i += 1) {
    const slot = n % 61;
    n = rotl((n + 0x9e3779b9) >>> 0, 7 + (7 & i));
    slots[slot] = (n ^ avalanche(n)) >>> 0;
    n = avalanche((n + slot) >>> 0);
  }
  return { slots, acc: avalanche(0xa5a5a5a5 ^ n) >>> 0 };
}

/** Generate `length` keystream bytes, advancing the state exactly as the original does. */
export function keystream(state: CryptoState, length: number): Uint8Array {
  const { slots } = state;
  let acc = state.acc;
  const out = new Uint8Array(length);
  let counter = 0;
  let position = 0;
  while (position < length) {
    const slot = acc % 61;
    const stored = slots[slot];
    const written = stored !== undefined;
    const mixed = (((written ? stored : 0) ^ Math.imul(0x9e3779b9, counter + 1)) >>> 0);
    const previous = acc;
    // When the slot exists the original's `& i` term is all-ones, collapsing to OR.
    const lane = written
      ? ((previous ^ mixed) | (previous & mixed)) >>> 0
      : (previous ^ mixed) >>> 0;
    const folded = (rotl((lane + previous) >>> 0, 31 & slot)
      ^ rotl(previous, 31 & Math.imul(slot, 7))) >>> 0;
    acc = avalanche((folded + 0x9e3779b9) >>> 0);
    slots[slot] = acc;
    counter += 1;
    for (const shift of [0, 8, 16, 24]) {
      if (position < length) out[position++] = (acc >>> shift) & 0xff;
    }
  }
  state.acc = acc;
  return out;
}

/** base64url -> bytes, tolerating both padded and unpadded input. */
export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(4 * Math.ceil(normalized.length / 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Decrypt a `/sources` response body.
 * Throws `decrypt failed: bad seed or tampered payload` when the magic prefix is wrong,
 * which is what the site's own client throws (stale seed or 401-recovered retry).
 */
export function decryptStreamPayload(payload: string, seed: string, mediaId: number): string {
  if (mediaId === undefined || mediaId === null || Number.isNaN(mediaId)) {
    throw new Error('mediaId is required to decode sources');
  }
  let body = payload.trim();
  // ofetch parses a JSON body, so the response can arrive quoted.
  if (body.startsWith('"') && body.endsWith('"') && body.length > 1) {
    try {
      body = JSON.parse(body) as string;
    } catch {
      body = body.slice(1, -1);
    }
  }
  const cipher = base64UrlToBytes(body);
  const stream = keystream(initState(seed, mediaId), cipher.length);
  const plain = new Uint8Array(cipher.length);
  for (let i = 0; i < cipher.length; i += 1) plain[i] = cipher[i] ^ stream[i];
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (plain[i] !== MAGIC[i]) throw new Error('decrypt failed: bad seed or tampered payload');
  }
  return new TextDecoder('utf-8').decode(plain.subarray(MAGIC.length));
}

