/**
 * Keyward — cryptographic core.
 *
 * Every secret the Vault stores is sealed here with AES-256-GCM under a key
 * derived from the Vault master passphrase (PBKDF2-SHA-256). Nothing outside
 * this module ever touches a raw key, and nothing that leaves the Vault is
 * ever in the clear — inspect localStorage and you get ciphertext.
 *
 * Runs unchanged in the browser and in Node 20+ (both expose Web Crypto as
 * globalThis.crypto), so the same code is exercised by the test suite.
 */

const g = globalThis.crypto;
if (!g || !g.subtle) throw new Error('Web Crypto unavailable — Keyward needs a secure context (https or localhost).');

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---- byte helpers ---- */
export function randomBytes(n) {
  const b = new Uint8Array(n);
  g.getRandomValues(b);
  return b;
}
export function toB64(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
export function fromB64(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
export function toHex(bytes) {
  return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
}

/* ---- key derivation ---- */
const PBKDF2_ITERS = 310000; // OWASP 2023 floor for PBKDF2-SHA256

export async function deriveMasterKey(passphrase, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : randomBytes(16);
  const base = await g.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await g.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { key, salt: toB64(salt) };
}

/* ---- authenticated encryption ---- */
export async function seal(key, plaintext) {
  const iv = randomBytes(12);
  const ct = await g.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}
export async function open(key, box) {
  try {
    const pt = await g.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
    return dec.decode(pt);
  } catch {
    // GCM authentication failed: wrong key, or the ciphertext was tampered with.
    return null;
  }
}

/* ---- password verifier (user login, distinct from the Vault master key) ---- */
export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : randomBytes(16);
  const base = await g.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await g.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' }, base, 256);
  return { salt: toB64(salt), hash: toHex(new Uint8Array(bits)) };
}
export async function verifyPassword(password, saltB64, expectedHex) {
  const { hash } = await hashPassword(password, saltB64);
  // length-independent equality is fine here; both are fixed 64-hex-char digests
  return hash === expectedHex;
}

/* ---- hashing (audit-log chain + integrity checks) ---- */
export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  const h = await g.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(h));
}

/* ---- HMAC-SHA-1 (RFC 4226/6238 — used by TOTP) ---- */
export async function hmacSha1(keyBytes, msgBytes) {
  const k = await g.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await g.subtle.sign('HMAC', k, msgBytes);
  return new Uint8Array(sig);
}
