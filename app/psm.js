/**
 * Keyward — Privileged Session Manager (PSM).
 *
 * The chaperone. When a user connects, PSM checks out the credential from the
 * Vault and injects it into the session WITHOUT ever showing it to the user,
 * isolates the session, and records everything with timestamps. While the
 * session is live the recording sits here (locally); on disconnect it ships to
 * the Vault, which becomes its permanent home. An auditor replays it from there.
 */
import * as vault from './vault.js';
import { emit } from './bus.js';
import { simTime } from './clock.js';

const active = new Map(); // sessionId -> session

/**
 * Open a brokered session. The returned handle carries NO password; the
 * injected credential is held privately inside the closure.
 */
export async function connect(user, accountId) {
  const a = vault.getAccount(accountId);
  if (!a) throw new Error('no such account');
  if (!vault.can(user, a.safeId, 'use')) {
    await vault.log(user.email, 'connect-denied', `Denied session to ${a.username}@${a.address}`, { accountId });
    return { denied: true };
  }
  const injected = await vault.checkoutForSession(accountId); // never leaves this scope
  const session = {
    id: 'sess_' + Math.random().toString(36).slice(2, 8),
    accountId, username: a.username, address: a.address, system: a.system,
    user: user.email, start: simTime(), events: [], cwd: '/', ended: false,
    _cred: injected,
  };
  active.set(session.id, session);
  record(session, `── session opened to ${a.username}@${a.address} (${a.system}) · credential injected by PSM, hidden from operator ──`);
  await vault.log(user.email, 'connect', `Opened brokered session to ${a.username}@${a.address}`, { accountId, sessionId: session.id });
  emit('psm:connect', { sessionId: session.id, accountId, user: user.email });
  return session;
}

function record(session, line) {
  session.events.push({ t: simTime(), line });
  emit('psm:activity', { sessionId: session.id, line });
}

/* A tiny simulated target shell so the recorded session is real activity, not
   lorem ipsum. Commands run against a per-system fake filesystem/state. */
const FS = {
  windows: { prompt: (s) => `C:\\> `, who: (s) => s.username, files: ['Windows', 'Users', 'Program Files', 'inetpub'] },
  linux: { prompt: (s) => `[${s.username}@${s.address.split('.').pop()} ~]# `, who: (s) => s.username, files: ['etc', 'var', 'home', 'opt', 'root'] },
  database: { prompt: (s) => `SQL> `, who: (s) => s.username, files: ['master', 'msdb', 'appdb', 'audit'] },
};
function kind(system) {
  const s = system.toLowerCase();
  if (s.includes('win')) return 'windows';
  if (s.includes('sql') || s.includes('oracle') || s.includes('db')) return 'database';
  return 'linux';
}

export function prompt(session) { return FS[kind(session.system)].prompt(session); }

export function run(session, cmdline) {
  if (session.ended) return 'session closed';
  record(session, prompt(session) + cmdline);
  const k = kind(session.system);
  const fs = FS[k];
  const [cmd, ...args] = cmdline.trim().split(/\s+/);
  let out = '';
  switch (cmd) {
    case '': break;
    case 'help': out = 'Recorded demo shell. Try: whoami, hostname, ls/dir, ps, cat <f>, sql, exit'; break;
    case 'whoami': out = fs.who(session); break;
    case 'hostname': out = session.address; break;
    case 'id': out = `uid=0(${session.username}) gid=0(root) — privileged`; break;
    case 'ls': case 'dir': out = fs.files.join(k === 'windows' ? '\t' : '  '); break;
    case 'ps': out = 'PID  CMD\n  1  systemd\n 42  sshd\n 88  ' + (k === 'database' ? 'sqlservr' : 'nginx'); break;
    case 'cat': out = args[0] ? `(${args[0]}) — contents withheld in demo` : 'usage: cat <file>'; break;
    case 'sql': out = k === 'database' ? 'SELECT name FROM sys.databases;\n' + fs.files.join('\n') : 'not a database target'; break;
    case 'sudo': out = 'already running with the privileged account'; break;
    case 'exit': case 'logout': out = '(type Disconnect to end the recorded session)'; break;
    default: out = `${cmd}: command not found`;
  }
  if (out) record(session, out);
  return out;
}

/** End the session and ship the recording to the Vault. */
export async function disconnect(sessionId) {
  const session = active.get(sessionId);
  if (!session || session.ended) return null;
  session.ended = true;
  record(session, '── session closed ──');
  session.end = simTime();
  active.delete(sessionId);
  delete session._cred;
  const rec = await vault.saveRecording({
    accountId: session.accountId, username: session.username, address: session.address,
    system: session.system, user: session.user, start: session.start, end: session.end,
    events: session.events,
  });
  emit('psm:disconnect', { sessionId, recordingId: rec.id });
  return rec;
}

export function liveSessions() { return [...active.values()]; }
export function getSession(id) { return active.get(id); }
/** PTA calls this to terminate a session it deems malicious. */
export async function kill(sessionId, reason) {
  const s = active.get(sessionId);
  if (!s) return;
  record(s, `── SESSION TERMINATED by PTA: ${reason} ──`);
  await disconnect(sessionId);
}
