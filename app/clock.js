/**
 * Keyward — simulation clock ("business time").
 *
 * Real password rotation happens over days; a demo can't wait days. This clock
 * advances a separate, accelerated timeline that the CPM scheduler and session
 * timestamps run against. It is deliberately NOT used for MFA — TOTP must use
 * the real wall clock to interoperate with real authenticator apps.
 *
 * One real-time tick = `hoursPerTick` simulated hours. Emits 'clock:tick' with
 * the current simulated epoch (ms). Speed is user-controllable from the UI.
 */
import { emit } from './bus.js';

const TICK_MS = 1000;          // real interval between ticks
const HOUR = 3600 * 1000;

let simNow = Date.now();       // simulated epoch, ms
let hoursPerTick = 1;          // default pace: 1 real second = 1 sim hour
let timer = null;

export function simTime() { return simNow; }
export function setSpeed(h) { hoursPerTick = h; emit('clock:speed', h); }
export function getSpeed() { return hoursPerTick; }

export function start() {
  if (timer) return;
  timer = setInterval(() => {
    if (hoursPerTick <= 0) return;         // paused
    simNow += hoursPerTick * HOUR;
    emit('clock:tick', simNow);
  }, TICK_MS);
}
export function stop() { clearInterval(timer); timer = null; }

/** Jump the simulated clock forward by N days at once (the "fast-forward" button). */
export function advanceDays(days) {
  simNow += days * 24 * HOUR;
  emit('clock:tick', simNow);
  emit('clock:jump', simNow);
}

export function fmtSim(ts = simNow) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
