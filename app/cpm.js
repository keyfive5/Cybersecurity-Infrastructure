/**
 * Keyward — Central Policy Manager (CPM).
 *
 * The password robot. It reads rotation policies (which live in the Vault),
 * and when an account is due it generates a new compliant password, "connects"
 * to the target machine, sets the password there, and updates the Vault to
 * match — both sides move together, because if they fall out of sync the login
 * breaks. It also verifies and reconciles accounts. No human in the loop.
 */
import * as vault from './vault.js';
import { on } from './bus.js';
import { simTime } from './clock.js';
import { randomBytes } from './crypto.js';

const DAY = 24 * 3600 * 1000;
const SETS = { lower: 'abcdefghijkmnpqrstuvwxyz', upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', digits: '23456789', symbols: '!@#$%^&*-_=+' };

export function generatePassword(policy) {
  const p = policy || { minLength: 16, complexity: { lower: true, upper: true, digits: true, symbols: true } };
  const len = Math.max(p.minLength || 16, 12);
  const classes = Object.keys(SETS).filter((c) => p.complexity?.[c]);
  const pool = classes.map((c) => SETS[c]).join('') || SETS.lower + SETS.upper + SETS.digits;
  const rnd = randomBytes(len * 2);
  const chars = [];
  // guarantee at least one of each required class
  classes.forEach((c, i) => { chars.push(SETS[c][rnd[i] % SETS[c].length]); });
  for (let i = chars.length; i < len; i++) chars.push(pool[rnd[i] % pool.length]);
  // shuffle
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd[len + i] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

export function isDue(account) {
  const pol = account.policyId ? vault.getPolicy(account.policyId) : null;
  if (!pol) return false;
  return simTime() - account.lastRotated >= pol.rotationDays * DAY;
}

export function daysUntilDue(account) {
  const pol = account.policyId ? vault.getPolicy(account.policyId) : null;
  if (!pol) return Infinity;
  return (pol.rotationDays * DAY - (simTime() - account.lastRotated)) / DAY;
}

/** Rotate one account now. */
export async function rotate(accountId, actor = 'CPM') {
  const a = vault.getAccount(accountId);
  if (!a) return null;
  const pol = a.policyId ? vault.getPolicy(a.policyId) : null;
  const newPw = generatePassword(pol);
  await vault.applyRotation(accountId, newPw, actor);
  return a;
}

/** Verify: does the stored credential still work against the target? */
export async function verify(accountId) {
  return vault.checkSync(accountId);
}

/** Reconcile: an out-of-sync account is force-rotated so both sides match again. */
export async function reconcile(accountId, actor = 'CPM') {
  const inSync = await vault.checkSync(accountId);
  if (inSync) return { reconciled: false, reason: 'already in sync' };
  await rotate(accountId, actor);
  await vault.log(actor, 'reconcile', `Reconciled ${vault.getAccount(accountId).username} — forced rotation brought Vault and target back in sync`, { accountId });
  return { reconciled: true };
}

/** The scheduler: every business-time tick, rotate whatever is due. */
export function startScheduler() {
  return on('clock:tick', async () => {
    if (!vault.isUnlocked()) return;
    for (const a of vault.accounts()) {
      if (isDue(a)) await rotate(a.id, 'CPM (scheduled)');
    }
  });
}
