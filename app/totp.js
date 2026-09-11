/**
 * Keyward — RFC 4226 (HOTP) / RFC 6238 (TOTP).
 *
 * This is real, standards-compliant TOTP: the secrets it mints and the codes
 * it checks interoperate with Google Authenticator, Authy, 1Password, etc.
 * The otpauth:// URI it builds is fed to Keyward's own QR engine so a user can
 * enrol MFA by scanning it with a genuine authenticator app.
 */
import { hmacSha1, randomBytes } from './crypto.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A fresh MFA secret: 20 random bytes, base32 per the authenticator convention. */
export function generateSecret() {
  return base32Encode(randomBytes(20));
}

function counterBytes(counter) {
  const buf = new Uint8Array(8);
  // 64-bit big-endian; JS bitops are 32-bit so split hi/lo.
  let hi = Math.floor(counter / 0x100000000);
  let lo = counter >>> 0;
  for (let i = 7; i >= 4; i--) { buf[i] = lo & 0xff; lo = Math.floor(lo / 256); }
  for (let i = 3; i >= 0; i--) { buf[i] = hi & 0xff; hi = Math.floor(hi / 256); }
  return buf;
}

export async function hotp(secretB32, counter, digits = 6) {
  const mac = await hmacSha1(base32Decode(secretB32), counterBytes(counter));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export async function totp(secretB32, { period = 30, digits = 6, t = Date.now() } = {}) {
  const counter = Math.floor(t / 1000 / period);
  return hotp(secretB32, counter, digits);
}

/**
 * Verify a code with a ±window tolerance (clock drift). Returns true/false.
 * Default window 1 accepts the previous and next step, as most servers do.
 */
export async function verifyTotp(secretB32, code, { period = 30, digits = 6, window = 1, t = Date.now() } = {}) {
  const clean = String(code).replace(/\s/g, '');
  const counter = Math.floor(t / 1000 / period);
  for (let w = -window; w <= window; w++) {
    if (await hotp(secretB32, counter + w, digits) === clean) return true;
  }
  return false;
}

export function otpauthURI({ issuer, account, secret, digits = 6, period = 30 }) {
  // Label is issuer:account with the colon kept literal (the accepted convention);
  // each half is percent-encoded so spaces/@ in names don't break the URI.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Seconds remaining in the current TOTP step — drives the countdown ring. */
export function secondsRemaining(period = 30, t = Date.now()) {
  return period - (Math.floor(t / 1000) % period);
}
