/**
 * Keyward — event bus.
 *
 * The architecture's whole point is that the components are separate and talk
 * through well-defined events (PVWA hands a connection to PSM, CPM writes a
 * rotation, PTA listens to everything). This tiny pub/sub is that wiring.
 */
const listeners = new Map();

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}

export function emit(type, payload) {
  listeners.get(type)?.forEach((fn) => {
    try { fn(payload); } catch (e) { console.error(`bus handler for "${type}" threw`, e); }
  });
  listeners.get('*')?.forEach((fn) => { try { fn({ type, payload }); } catch {} });
}
