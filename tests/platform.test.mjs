/**
 * Platform integration tests — the whole component layer, headless.
 * Exercises Vault + CPM + PSM + PTA together the way the UI will.
 * Run: node tests/platform.test.mjs
 */
import assert from 'node:assert';

// minimal localStorage shim so the browser modules run under Node
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const vault = await import('../app/vault.js');
const cpm = await import('../app/cpm.js');
const psm = await import('../app/psm.js');
const pta = await import('../app/pta.js');
const attacks = await import('../app/attacks.js');
const { seedIfEmpty, DEMO_PASSWORD } = await import('../app/seed.js');
const { totp } = await import('../app/totp.js');
const { generateSecret } = await import('../app/totp.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\nKeyward platform tests\n');

vault.load();
await vault.bootstrap('master-vault-passphrase');
await seedIfEmpty();
pta.start();

const alice = vault.findUser('alice@northwind.co');
const sam = vault.findUser('sam@northwind.co');
const dana = vault.findUser('dana@northwind.co');
const ravi = vault.findUser('ravi@northwind.co');

await t('user login verifies with correct password and rejects wrong', async () => {
  assert.ok(await vault.verifyLogin('alice@northwind.co', DEMO_PASSWORD));
  assert.equal(await vault.verifyLogin('alice@northwind.co', 'nope'), null);
});

await t('MFA enrolment + verification round-trips a real TOTP', async () => {
  const secret = generateSecret();
  await vault.enrollMfa(alice.id, secret);
  const back = await vault.getMfaSecret(alice.id);
  assert.equal(back, secret);
  const code = await totp(secret);
  const { verifyTotp } = await import('../app/totp.js');
  assert.ok(await verifyTotp(secret, code));
});

await t('stored credentials are ciphertext on disk (no plaintext leak)', () => {
  const dump = globalThis.localStorage.getItem('keyward.vault.v1');
  assert.ok(!dump.includes('W!nterDC-2026'), 'seed password must not appear in storage');
  assert.ok(!dump.includes('S@Server-db01'));
});

await t('scoped view: DBA sees only database accounts, auditor sees all', () => {
  const samAccts = vault.accountsFor(sam);
  assert.ok(samAccts.length > 0 && samAccts.every((a) => a.system.includes('SQL') || a.system.includes('Oracle')));
  const danaAccts = vault.accountsFor(dana);
  assert.equal(danaAccts.length, vault.accounts().length); // auditor lists everything
});

await t('auditor is denied password retrieval; admin is allowed', async () => {
  const anyDb = vault.accountsFor(sam)[0];
  const denied = await vault.revealPassword(dana, anyDb.id);
  assert.ok(denied.denied, 'auditor must not retrieve');
  const ok = await vault.revealPassword(alice, anyDb.id);
  assert.ok(ok.password && ok.password.length > 0);
});

await t('CPM rotates a credential and keeps Vault and target in sync', async () => {
  const a = vault.accounts()[0];
  const beforeReveal = (await vault.revealPassword(alice, a.id)).password;
  await cpm.rotate(a.id);
  const afterReveal = (await vault.revealPassword(alice, a.id)).password;
  assert.notEqual(beforeReveal, afterReveal, 'password should change');
  assert.ok(await cpm.verify(a.id), 'Vault and target must match after rotation');
  assert.ok(a.rotations >= 1);
});

await t('generated passwords satisfy the policy (length + classes)', () => {
  const pol = { minLength: 20, complexity: { lower: true, upper: true, digits: true, symbols: true } };
  for (let i = 0; i < 50; i++) {
    const pw = cpm.generatePassword(pol);
    assert.ok(pw.length >= 20);
    assert.ok(/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^a-zA-Z0-9]/.test(pw), 'all classes present: ' + pw);
  }
});

await t('out-of-band change desyncs, reconcile restores sync', async () => {
  const a = vault.accounts()[1];
  await vault.desyncTarget(a.id);
  assert.equal(await cpm.verify(a.id), false);
  const r = await cpm.reconcile(a.id);
  assert.ok(r.reconciled);
  assert.ok(await cpm.verify(a.id));
});

await t('PSM brokers a session, records it, hides the password, ships to Vault', async () => {
  const a = vault.accountsFor(ravi).find((x) => x.system.includes('RHEL'));
  const s = await psm.connect(ravi, a.id);
  assert.ok(!s.denied && s.id);
  psm.run(s, 'whoami');
  psm.run(s, 'ls');
  const rec = await psm.disconnect(s.id);
  assert.ok(rec && rec.events.length >= 4, 'recording captured events');
  // the recording must not contain the injected credential anywhere
  const injected = (await vault.revealPassword(alice, a.id)).password;
  assert.ok(!JSON.stringify(rec.events).includes(injected), 'password must never appear in the recording');
  assert.ok(vault.getRecording(rec.id), 'recording lives in the Vault');
});

await t('PSM denies a session when the user lacks Use on the safe', async () => {
  const dbAcct = vault.accounts().find((a) => a.system.includes('SQL'));
  const res = await psm.connect(ravi, dbAcct.id); // Ravi has no DB access
  assert.ok(res.denied);
});

await t('PTA detects a credential bypass and auto-remediates (rotate)', async () => {
  const a = vault.accounts().find((x) => x.system.includes('Ubuntu'));
  const before = a.rotations;
  const openBefore = vault.alerts().length;
  attacks.directLogin(a.id);
  await sleep(50); // let async handlers run
  const alert = vault.alerts().find((al) => al.type === 'credential-bypass' && al.accountId === a.id);
  assert.ok(alert, 'bypass alert raised');
  assert.equal(alert.severity, 'high');
  assert.equal(alert.status, 'remediated', 'high severity auto-remediates');
  assert.ok(a.rotations > before, 'remediation rotated the exposed credential');
  assert.ok(vault.alerts().length > openBefore);
});

await t('PTA detects brute force and mass retrieval', async () => {
  const a = vault.accounts()[2];
  attacks.bruteForce(a.id, 6);
  await sleep(30);
  assert.ok(vault.alerts().some((al) => al.type === 'brute-force'));
  attacks.massRetrieve('mallory@northwind.co', vault.accounts().slice(0, 5));
  await sleep(30);
  assert.ok(vault.alerts().some((al) => al.type === 'mass-retrieval'));
});

await t('audit log is a valid hash chain; tampering breaks it', async () => {
  let v = await vault.verifyChain();
  assert.ok(v.ok, 'chain valid before tampering');
  vault.raw().logs[3].detail = 'TAMPERED';
  v = await vault.verifyChain();
  assert.ok(!v.ok && v.brokenAt, 'tampering detected');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
