/**
 * Keyward — the Digital Vault (EPV).
 *
 * The single source of truth. Every other component reads from and writes to
 * the Vault and nothing stores privileged data independently. On disk (in
 * localStorage) every credential is an AES-GCM box — inspect storage and you
 * see ciphertext, never a password. The master key lives only in memory, only
 * after the Vault is unlocked with its passphrase.
 *
 * The audit log is an append-only hash chain: each entry commits to the one
 * before it, so a tampered or deleted record breaks verification.
 */
import { deriveMasterKey, seal, open, sha256Hex, hashPassword, verifyPassword, randomBytes, toHex } from './crypto.js';
import { emit } from './bus.js';
import { simTime } from './clock.js';

const LSKEY = 'keyward.vault.v1';
const VERIFIER_TEXT = 'KEYWARD-MASTER-VERIFIER';

/** Safe-member authorizations, modelled on CyberArk safe permissions. */
export const PERMS = ['list', 'use', 'retrieve', 'add', 'manage', 'audit'];
export const PERM_LABEL = {
  list: 'List accounts', use: 'Use (connect)', retrieve: 'Retrieve password',
  add: 'Add / onboard', manage: 'Manage policies', audit: 'Audit (logs & recordings)',
};

function uid(prefix) { return prefix + '_' + toHex(randomBytes(4)); }

let state = null;   // persisted structure
let key = null;     // CryptoKey, memory-only

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */
function blank() {
  return {
    meta: { salt: null, verifier: null, initialized: false, createdSim: simTime() },
    users: [], safes: [], accounts: [], targets: [], policies: [],
    logs: [], recordings: [], alerts: [],
    seq: 0,
  };
}
function load() {
  try {
    const raw = localStorage.getItem(LSKEY);
    state = raw ? JSON.parse(raw) : blank();
  } catch { state = blank(); }
}
function persist() {
  try { localStorage.setItem(LSKEY, JSON.stringify(state)); }
  catch (e) { console.error('Vault persist failed', e); }
}
export function raw() { return state; }               // read-only accessors for the UI
export function wipe() { localStorage.removeItem(LSKEY); state = blank(); key = null; }

/* ------------------------------------------------------------------ */
/* Lifecycle: bootstrap / unlock / lock                                */
/* ------------------------------------------------------------------ */
export function isInitialized() { if (!state) load(); return !!state.meta.initialized; }
export function isUnlocked() { return !!key; }

export async function bootstrap(passphrase) {
  if (!state) load();
  const { key: k, salt } = await deriveMasterKey(passphrase);
  key = k;
  state.meta.salt = salt;
  state.meta.verifier = await seal(key, VERIFIER_TEXT);
  state.meta.initialized = true;
  persist();
}

export async function unlock(passphrase) {
  if (!state) load();
  if (!state.meta.initialized) return false;
  const { key: k } = await deriveMasterKey(passphrase, state.meta.salt);
  if (await open(k, state.meta.verifier) !== VERIFIER_TEXT) return false;
  key = k;
  return true;
}
export function lock() { key = null; }
function requireKey() { if (!key) throw new Error('Vault is locked'); }

/* ------------------------------------------------------------------ */
/* Audit log (hash chain)                                              */
/* ------------------------------------------------------------------ */
// The chain read-modify-write must be atomic: log() awaits the hash between
// reading the previous hash and appending, so without serialization two
// concurrent callers (e.g. a PTA remediation logging while an event logs)
// could commit against the same prevHash and fork the chain. This queue makes
// every append run to completion before the next one starts.
let logTail = Promise.resolve();
export function log(actor, action, detail, meta = {}) {
  const run = async () => {
    const prevHash = state.logs.length ? state.logs[state.logs.length - 1].hash : 'GENESIS';
    const entry = { seq: ++state.seq, ts: simTime(), actor, action, detail, meta, prevHash };
    entry.hash = await sha256Hex(prevHash + JSON.stringify({ seq: entry.seq, ts: entry.ts, actor, action, detail, meta }));
    state.logs.push(entry);
    persist();
    emit('vault:log', entry);
    return entry;
  };
  const p = logTail.then(run, run);
  logTail = p.catch(() => {}); // keep the queue alive even if one append throws
  return p;
}
/** Recompute the chain; returns {ok, brokenAt}. Powers the "verify integrity" button. */
export async function verifyChain() {
  let prev = 'GENESIS';
  for (const e of state.logs) {
    const h = await sha256Hex(prev + JSON.stringify({ seq: e.seq, ts: e.ts, actor: e.actor, action: e.action, detail: e.detail, meta: e.meta }));
    if (h !== e.hash || e.prevHash !== prev) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, brokenAt: null };
}

/* ------------------------------------------------------------------ */
/* Users, auth, MFA                                                    */
/* ------------------------------------------------------------------ */
export function users() { return state.users; }
export function findUser(email) { return state.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase()); }
export function getUser(id) { return state.users.find((u) => u.id === id); }

export async function addUser({ name, email, role, password, safes = {} }) {
  requireKey();
  const pw = await hashPassword(password);
  const u = { id: uid('usr'), name, email, role, pw, mfa: null, safes };
  state.users.push(u);
  persist();
  return u;
}
export async function verifyLogin(email, password) {
  const u = findUser(email);
  if (!u) return null;
  return (await verifyPassword(password, u.pw.salt, u.pw.hash)) ? u : null;
}

export async function enrollMfa(userId, secretB32) {
  requireKey();
  const u = getUser(userId);
  u.mfa = await seal(key, secretB32);
  persist();
}
export async function getMfaSecret(userId) {
  requireKey();
  const u = getUser(userId);
  return u?.mfa ? await open(key, u.mfa) : null;
}
export function hasMfa(userId) { return !!getUser(userId)?.mfa; }

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */
export function can(user, safeId, perm) {
  if (!user) return false;
  const m = user.safes?.[safeId];
  return !!(m && m[perm]);
}
/** Every safe the user can at least list. */
export function safesFor(user) {
  return state.safes.filter((s) => user.safes?.[s.id]?.list);
}

/* ------------------------------------------------------------------ */
/* Safes & policies                                                    */
/* ------------------------------------------------------------------ */
export function safes() { return state.safes; }
export function getSafe(id) { return state.safes.find((s) => s.id === id); }
export function addSafe({ name, desc }) { const s = { id: uid('safe'), name, desc }; state.safes.push(s); persist(); return s; }

export function policies() { return state.policies; }
export function getPolicy(id) { return state.policies.find((p) => p.id === id); }
export function addPolicy(p) { const pol = { id: uid('pol'), ...p }; state.policies.push(pol); persist(); return pol; }
export function updatePolicy(id, patch) { Object.assign(getPolicy(id), patch); persist(); }

/* ------------------------------------------------------------------ */
/* Accounts & targets                                                  */
/* ------------------------------------------------------------------ */
export function accounts() { return state.accounts; }
export function getAccount(id) { return state.accounts.find((a) => a.id === id); }
export function accountsInSafe(safeId) { return state.accounts.filter((a) => a.safeId === safeId); }

/** The scoped view: only accounts in safes the user can list. */
export function accountsFor(user) {
  return state.accounts.filter((a) => can(user, a.safeId, 'list'));
}

export function getTarget(address) { return state.targets.find((t) => t.address === address); }

export async function addAccount({ safeId, system, address, platform, username, password, policyId }, actor = 'system') {
  requireKey();
  const secret = await seal(key, password);
  const acct = {
    id: uid('acct'), safeId, system, address, platform, username,
    secret, policyId: policyId || null,
    lastRotated: simTime(), targetSynced: true, rotations: 0,
  };
  state.accounts.push(acct);
  // provision / update the simulated target machine to hold the same credential
  let target = getTarget(address);
  if (!target) { target = { id: uid('tgt'), address, system, cred: null }; state.targets.push(target); }
  target.cred = await seal(key, password);
  persist();
  await log(actor, 'onboard', `Onboarded ${username}@${address} into ${getSafe(safeId)?.name}`, { accountId: acct.id });
  emit('vault:onboard', acct);
  return acct;
}

/** Explicit password retrieval by a user — requires `retrieve` and is audited. */
export async function revealPassword(user, accountId) {
  requireKey();
  const a = getAccount(accountId);
  if (!a) return null;
  if (!can(user, a.safeId, 'retrieve')) { await log(user.email, 'retrieve-denied', `Denied password for ${a.username}@${a.address}`, { accountId }); return { denied: true }; }
  const pw = await open(key, a.secret);
  await log(user.email, 'retrieve', `Retrieved password for ${a.username}@${a.address}`, { accountId });
  emit('vault:reveal', { user: user.email, accountId, ts: simTime() });
  return { password: pw };
}

/** Internal credential checkout for the PSM broker — never surfaced to the user. */
export async function checkoutForSession(accountId) {
  requireKey();
  const a = getAccount(accountId);
  const pw = await open(key, a.secret);
  emit('psm:checkout', { accountId, ts: simTime() });
  return pw;
}

/** Apply a rotation: reseal the account secret AND update the target together. */
export async function applyRotation(accountId, newPassword, actor = 'CPM') {
  requireKey();
  const a = getAccount(accountId);
  a.secret = await seal(key, newPassword);
  const target = getTarget(a.address);
  if (target) target.cred = await seal(key, newPassword);
  a.lastRotated = simTime();
  a.targetSynced = true;
  a.rotations++;
  persist();
  await log(actor, 'rotate', `Rotated ${a.username}@${a.address} (cycle ${a.rotations})`, { accountId });
  emit('cpm:rotated', { accountId, ts: simTime() });
  return a;
}

/** Knock an account out of sync with its target (used to demo CPM reconcile). */
export async function desyncTarget(accountId) {
  requireKey();
  const a = getAccount(accountId);
  const target = getTarget(a.address);
  if (target) target.cred = await seal(key, 'OUT-OF-BAND-' + toHex(randomBytes(3)));
  a.targetSynced = false;
  persist();
  await log('system', 'desync', `${a.username}@${a.address} password changed out-of-band — Vault and target no longer match`, { accountId });
  emit('cpm:desync', { accountId });
}

/** Does the Vault's stored secret still match the target machine? */
export async function checkSync(accountId) {
  requireKey();
  const a = getAccount(accountId);
  const target = getTarget(a.address);
  if (!target) return false;
  const inSync = (await open(key, a.secret)) === (await open(key, target.cred));
  a.targetSynced = inSync;
  persist();
  return inSync;
}

/* ------------------------------------------------------------------ */
/* Session recordings                                                  */
/* ------------------------------------------------------------------ */
export function recordings() { return state.recordings; }
export function getRecording(id) { return state.recordings.find((r) => r.id === id); }
export async function saveRecording(rec) {
  const stored = { id: uid('rec'), ...rec };
  state.recordings.push(stored);
  persist();
  await log('PSM', 'session-archived', `Session recording for ${rec.username}@${rec.address} shipped to Vault (${rec.events.length} events)`, { recordingId: stored.id, accountId: rec.accountId });
  emit('psm:archived', stored);
  return stored;
}

/* ------------------------------------------------------------------ */
/* Alerts (raised by PTA)                                              */
/* ------------------------------------------------------------------ */
export function alerts() { return state.alerts; }
export async function raiseAlert(a) {
  const alert = { id: uid('alrt'), ts: simTime(), status: 'open', ...a };
  state.alerts.push(alert);
  persist();
  await log('PTA', 'alert', `${a.severity.toUpperCase()}: ${a.title}`, { alertId: alert.id, accountId: a.accountId });
  emit('pta:alert', alert);
  return alert;
}
export function updateAlert(id, patch) {
  const a = state.alerts.find((x) => x.id === id);
  if (a) { Object.assign(a, patch); persist(); emit('pta:alert-update', a); }
}

export { load };
