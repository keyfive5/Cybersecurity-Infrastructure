/**
 * Kernel tests: crypto sealing + RFC 6238 TOTP interop + QR round-trip.
 * Run: node tests/kernel.test.mjs   (Node 20+, uses global Web Crypto)
 */
import assert from 'node:assert';
import { deriveMasterKey, seal, open, sha256Hex } from '../app/crypto.js';
import { totp, verifyTotp, base32Encode, base32Decode, otpauthURI } from '../app/totp.js';
import { encodeText } from '../app/qr/encode.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

console.log('\nKeyward kernel tests\n');

await t('AES-GCM seal/open round-trips', async () => {
  const { key } = await deriveMasterKey('correct horse battery staple');
  const box = await seal(key, 'Admin@Winter2026!');
  assert.equal(await open(key, box), 'Admin@Winter2026!');
});

await t('wrong passphrase cannot open the box', async () => {
  const { key, salt } = await deriveMasterKey('right-key');
  const box = await seal(key, 'top-secret');
  const { key: wrong } = await deriveMasterKey('wrong-key', salt);
  assert.equal(await open(wrong, box), null);
});

await t('tampered ciphertext fails authentication', async () => {
  const { key } = await deriveMasterKey('k');
  const box = await seal(key, 'value');
  const b = atob(box.ct); const arr = [...b].map(c => c.charCodeAt(0)); arr[0] ^= 1;
  box.ct = btoa(String.fromCharCode(...arr));
  assert.equal(await open(key, box), null);
});

await t('same passphrase + salt re-derives a working key', async () => {
  const { key: k1, salt } = await deriveMasterKey('unlock-me');
  const box = await seal(k1, 'session-42');
  const { key: k2 } = await deriveMasterKey('unlock-me', salt);
  assert.equal(await open(k2, box), 'session-42');
});

await t('sha256 hash chain links records', async () => {
  const h0 = await sha256Hex('GENESIS');
  const h1 = await sha256Hex(h0 + JSON.stringify({ a: 1 }));
  const h1b = await sha256Hex(h0 + JSON.stringify({ a: 1 }));
  assert.equal(h1, h1b);
  const h1c = await sha256Hex(h0 + JSON.stringify({ a: 2 }));
  assert.notEqual(h1, h1c);
});

await t('base32 round-trips arbitrary bytes', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64, 32, 16, 8]);
  assert.deepEqual([...base32Decode(base32Encode(bytes))], [...bytes]);
});

// RFC 6238 Appendix B official test vectors (SHA-1 seed "12345678901234567890").
await t('TOTP matches RFC 6238 test vectors (SHA-1, 8 digits)', async () => {
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'));
  const cases = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ];
  for (const [sec, expected] of cases) {
    const got = await totp(secret, { t: sec * 1000, digits: 8, period: 30 });
    assert.equal(got, expected, `T=${sec} expected ${expected} got ${got}`);
  }
});

await t('verifyTotp accepts current code and rejects a wrong one', async () => {
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'));
  const now = 1111111109 * 1000;
  const code = await totp(secret, { t: now });
  assert.ok(await verifyTotp(secret, code, { t: now }));
  assert.ok(!await verifyTotp(secret, '000000', { t: now }));
});

await t('verifyTotp tolerates one step of clock drift', async () => {
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'));
  const now = 1111111109 * 1000;
  const prevStepCode = await totp(secret, { t: now - 30000 });
  assert.ok(await verifyTotp(secret, prevStepCode, { t: now, window: 1 }));
});

await t('otpauth URI is well-formed and scannable-shaped', () => {
  const uri = otpauthURI({ issuer: 'Keyward', account: 'alice@acme', secret: 'JBSWY3DPEHPK3PXP' });
  assert.ok(uri.startsWith('otpauth://totp/Keyward:alice'));
  assert.ok(/secret=JBSWY3DPEHPK3PXP/.test(uri));
  // and Keyward's own QR engine can encode it
  const qr = encodeText(uri);
  assert.ok(qr.size >= 21 && qr.modules.length === qr.size * qr.size);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
