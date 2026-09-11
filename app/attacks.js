/**
 * Keyward — attack simulator (demo range).
 *
 * These functions emit the *same* events a real environment would, so PTA is
 * genuinely reacting to an event stream it doesn't control — nothing here calls
 * PTA directly. Wired to the "Threat range" panel so the platform can be shown
 * detecting and auto-remediating live.
 */
import * as vault from './vault.js';
import { emit } from './bus.js';

const CITIES = [
  { city: 'Toronto', lat: 43.65, lon: -79.38 },
  { city: 'Frankfurt', lat: 50.11, lon: 8.68 },
  { city: 'Singapore', lat: 1.35, lon: 103.82 },
  { city: 'São Paulo', lat: -23.55, lon: -46.63 },
];

/** Someone uses a stolen/known password to hit a target directly, skipping PSM. */
export function directLogin(accountId) {
  const a = vault.getAccount(accountId);
  emit('target:directLogin', { accountId, address: a?.address, sourceIp: '185.220.101.' + (10 + Math.floor(Math.random() * 240)) });
}

/** A burst of failed logins against one account. */
export function bruteForce(accountId, n = 6) {
  for (let i = 0; i < n; i++) emit('auth:fail', { accountId, who: 'unknown@' + (100 + i) });
}

/** Two logins from far-apart cities seconds apart. */
export function impossibleTravel(user) {
  emit('auth:success', { user, geo: CITIES[0] });
  emit('auth:success', { user, geo: CITIES[1 + Math.floor(Math.random() * 3)] });
}

/** One user rapidly retrieving many credentials (harvesting). */
export async function massRetrieve(user, accounts) {
  for (const a of accounts) emit('vault:reveal', { user, accountId: a.id, ts: Date.now() });
}

/** Change a target's password out-of-band so Vault and target drift apart. */
export async function outOfBandChange(accountId) {
  await vault.desyncTarget(accountId);
}
