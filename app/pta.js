/**
 * Keyward — Privileged Threat Analytics (PTA).
 *
 * The watchdog. It subscribes to the whole event stream and raises alerts on
 * *circumstances*, not verbs (a lesson learned the hard way on earlier
 * detection work: matching on privileged verbs floods you with routine admin).
 * Where enabled, it drives automatic remediation — telling CPM to rotate a
 * credential it believes is compromised, or telling PSM to kill a live session.
 *
 * Detectors:
 *   • credential bypass   — a login to a target that did NOT go through PSM
 *                           (the canonical "someone is using a leaked password")
 *   • mass retrieval      — one user revealing many credentials in a short window
 *   • brute force         — repeated failed authentications against an account
 *   • impossible travel   — two authentications from far-apart locations too
 *                           close together in time (auth events only)
 *   • off-hours access    — privileged use in the middle of the night
 *   • unreconciled desync — Vault and target out of sync and not fixed
 */
import * as vault from './vault.js';
import * as cpm from './cpm.js';
import * as psm from './psm.js';
import { on, emit } from './bus.js';

export const config = {
  autoRemediate: true,
  offHoursStart: 22, offHoursEnd: 6,
  massRetrieveCount: 4, massRetrieveWindowMs: 60000,
  bruteForceCount: 5, bruteForceWindowMs: 60000,
  impossibleTravelKmPerHr: 900, // faster than a jet ⇒ impossible
};

const reveals = new Map();  // user -> [ts]
const fails = new Map();    // accountId -> [ts]
const lastAuth = new Map(); // user -> {ts, geo:{lat,lon,city}}

function within(list, windowMs, now = Date.now()) {
  return list.filter((t) => now - t <= windowMs);
}
function haversineKm(a, b) {
  const R = 6371, toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function remediate(alert) {
  if (!config.autoRemediate || !alert.accountId) return;
  const steps = [];
  // kill any live session on the account
  for (const s of psm.liveSessions()) {
    if (s.accountId === alert.accountId) { await psm.kill(s.id, alert.title); steps.push(`terminated live session ${s.id}`); }
  }
  // rotate the credential to invalidate whatever the attacker has
  await cpm.rotate(alert.accountId, 'PTA (auto-remediation)');
  steps.push('rotated credential to invalidate the exposed password');
  vault.updateAlert(alert.id, { status: 'remediated', remediation: steps });
  await vault.log('PTA', 'remediate', `Auto-remediated "${alert.title}": ${steps.join('; ')}`, { alertId: alert.id, accountId: alert.accountId });
  emit('pta:remediated', { alertId: alert.id, steps });
}

async function fire(a) {
  const alert = await vault.raiseAlert(a);
  if (a.severity === 'high') await remediate(alert);
  return alert;
}

let started = false;
export function start() {
  if (started) return; started = true;

  // ---- flagship: credential used outside Keyward (bypassed PSM) ----
  on('target:directLogin', async ({ accountId, address, sourceIp }) => {
    const a = vault.getAccount(accountId);
    await fire({
      severity: 'high', type: 'credential-bypass',
      title: 'Credential used outside Keyward',
      detail: `A direct login to ${a?.username || 'account'}@${address} bypassed PSM${sourceIp ? ` from ${sourceIp}` : ''}. The session was never brokered or recorded — the password is known to someone off-platform.`,
      accountId, riskScore: 95,
    });
  });

  // ---- mass credential retrieval ----
  on('vault:reveal', async ({ user, accountId }) => {
    const list = within([...(reveals.get(user) || []), Date.now()], config.massRetrieveWindowMs);
    reveals.set(user, list);
    if (list.length >= config.massRetrieveCount) {
      reveals.set(user, []); // avoid a storm of duplicate alerts
      await fire({
        severity: 'medium', type: 'mass-retrieval',
        title: 'Bulk credential retrieval',
        detail: `${user} retrieved ${list.length} passwords in under a minute — consistent with credential harvesting rather than day-to-day use.`,
        accountId, riskScore: 70,
      });
    }
  });

  // ---- brute force ----
  on('auth:fail', async ({ accountId, who }) => {
    const list = within([...(fails.get(accountId) || []), Date.now()], config.bruteForceWindowMs);
    fails.set(accountId, list);
    if (list.length >= config.bruteForceCount) {
      fails.set(accountId, []);
      const a = vault.getAccount(accountId);
      await fire({
        severity: 'medium', type: 'brute-force',
        title: 'Repeated authentication failures',
        detail: `${list.length} failed logins against ${a?.username || accountId}${who ? ` (attempts by ${who})` : ''} within a minute.`,
        accountId, riskScore: 65,
      });
    }
  });

  // ---- impossible travel (authentication events only) ----
  on('auth:success', async ({ user, geo }) => {
    if (geo && lastAuth.has(user)) {
      const prev = lastAuth.get(user);
      const hrs = Math.max((Date.now() - prev.ts) / 3600000, 1 / 60);
      const km = haversineKm(prev.geo, geo);
      if (km / hrs > config.impossibleTravelKmPerHr) {
        await fire({
          severity: 'medium', type: 'impossible-travel',
          title: 'Impossible travel',
          detail: `${user} authenticated from ${geo.city} then ${prev.geo.city} — ${Math.round(km)} km apart, ${hrs.toFixed(1)} h between logins. That's ${Math.round(km / hrs)} km/h.`,
          riskScore: 60,
        });
      }
    }
    if (geo) lastAuth.set(user, { ts: Date.now(), geo });
  });

  // ---- off-hours privileged access ----
  on('psm:connect', async ({ accountId, user }) => {
    const h = new Date().getHours();
    const off = config.offHoursStart > config.offHoursEnd
      ? (h >= config.offHoursStart || h < config.offHoursEnd)
      : (h >= config.offHoursStart && h < config.offHoursEnd);
    if (off) {
      const a = vault.getAccount(accountId);
      await fire({
        severity: 'low', type: 'off-hours',
        title: 'Off-hours privileged session',
        detail: `${user} connected to ${a?.username}@${a?.address} at ${String(h).padStart(2, '0')}:00 local — outside normal working hours.`,
        accountId, riskScore: 35,
      });
    }
  });

  // ---- unreconciled desync (posture) ----
  on('cpm:desync', async ({ accountId }) => {
    const a = vault.getAccount(accountId);
    await fire({
      severity: 'low', type: 'desync',
      title: 'Vault/target credential drift',
      detail: `${a?.username}@${a?.address} was changed out-of-band; the Vault no longer matches the target. Reconcile to restore control.`,
      accountId, riskScore: 40,
    });
  });
}

/** Reset in-memory windows (used by the attack sim between demos). */
export function reset() { reveals.clear(); fails.clear(); lastAuth.clear(); }
