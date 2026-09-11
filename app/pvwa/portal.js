/** Keyward PVWA — portal shell, dashboard, and router. */
import * as vault from '../vault.js';
import * as cpm from '../cpm.js';
import * as psm from '../psm.js';
import * as clock from '../clock.js';
import { on } from '../bus.js';
import { esc, toast } from '../ui.js';
import * as accounts from './accounts.js';
import * as sessions from './sessions.js';
import * as threats from './threats.js';
import * as admin from './admin.js';

const anySafe = (user, perm) => vault.safes().some((s) => vault.can(user, s.id, perm));

const VIEWS = [
  { id: 'dashboard', label: 'Dashboard', ic: '▤', gate: () => true, render: dashboard },
  { id: 'accounts', label: 'Accounts', ic: '🗝️', gate: (u) => vault.safesFor(u).length > 0, render: accounts.render },
  { id: 'sessions', label: 'Sessions', ic: '🖥️', gate: (u) => anySafe(u, 'use') || anySafe(u, 'audit'), render: sessions.render },
  { id: 'threats', label: 'Threat Analytics', ic: '🚨', gate: (u) => anySafe(u, 'manage') || anySafe(u, 'audit'), render: threats.render },
  { id: 'admin', label: 'Administration', ic: '⚙️', gate: (u) => anySafe(u, 'manage') || anySafe(u, 'audit'), render: admin.render },
];

export function mountPortal(rootEl, user, { onSignOut, onLock }) {
  const allowed = VIEWS.filter((v) => v.gate(user));
  rootEl.innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="brand"><div class="mark">K</div><b>Keyward</b></div>
      <nav class="nav" id="nav">
        ${allowed.map((v) => `<a href="#/${v.id}" data-v="${v.id}"><span class="ic">${v.ic}</span>${esc(v.label)}</a>`).join('')}
      </nav>
      <div class="foot">Privileged Access Management<br>Vault · PVWA · CPM · PSM · PTA<br>Built by M. Hasan Zafar</div>
    </aside>
    <div class="main">
      <div class="topbar">
        <div class="row" style="gap:6px" id="clockctl">
          <span class="tiny faint">business time</span>
          <span class="tag" id="simt"></span>
          <button class="btn sm ghost" data-spd="0" title="pause">⏸</button>
          <button class="btn sm ghost" data-spd="1" title="normal">▶</button>
          <button class="btn sm ghost" data-spd="8" title="fast">⏩</button>
          <button class="btn sm ghost" id="advday" title="jump a day">+1 day</button>
        </div>
        <div style="flex:1"></div>
        <a href="#/threats" class="tag" id="alertbadge" style="text-decoration:none"></a>
        <div class="row" style="gap:8px">
          <div style="text-align:right"><div class="small"><b>${esc(user.name)}</b></div><div class="tiny faint">${esc(user.role)}</div></div>
          <button class="btn sm ghost" id="lock" title="lock vault">🔒</button>
          <button class="btn sm ghost" id="signout">Sign out</button>
        </div>
      </div>
      <div class="content" id="content"></div>
    </div>
  </div>`;

  const content = rootEl.querySelector('#content');
  const ctx = { user, go, rerender: () => route() };

  function route() {
    let id = (location.hash.replace('#/', '') || 'dashboard');
    let view = allowed.find((v) => v.id === id) || allowed[0];
    rootEl.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.v === view.id));
    content.innerHTML = '';
    view.render(content, ctx);
  }
  function go(id) { if (location.hash === '#/' + id) route(); else location.hash = '#/' + id; }

  window.onhashchange = route;
  route();

  // clock controls
  const simt = rootEl.querySelector('#simt');
  const paintClock = () => { simt.textContent = clock.fmtSim(); };
  paintClock();
  rootEl.querySelectorAll('[data-spd]').forEach((b) => b.onclick = () => {
    clock.setSpeed(+b.dataset.spd);
    rootEl.querySelectorAll('[data-spd]').forEach((x) => x.classList.toggle('primary', x === b));
  });
  rootEl.querySelector('[data-spd="1"]').classList.add('primary');
  rootEl.querySelector('#advday').onclick = () => { clock.advanceDays(1); toast('Advanced business time by 1 day', 'ok'); };

  // badges + live clock
  const badge = rootEl.querySelector('#alertbadge');
  const paintBadge = () => {
    const open = vault.alerts().filter((a) => a.status === 'open').length;
    badge.className = 'tag ' + (open ? 'bad' : 'ok');
    badge.innerHTML = open ? `🚨 ${open} open alert${open === 1 ? '' : 's'}` : '🛡️ all clear';
  };
  paintBadge();
  const offs = [
    on('clock:tick', paintClock),
    on('pta:alert', () => { paintBadge(); }),
    on('pta:alert-update', paintBadge),
    on('cpm:rotated', () => { if ((location.hash || '').includes('dashboard')) route(); }),
  ];

  rootEl.querySelector('#lock').onclick = () => { offs.forEach((o) => o()); onLock(); };
  rootEl.querySelector('#signout').onclick = () => { offs.forEach((o) => o()); onSignOut(); };
}

/* ---- dashboard ---- */
function dashboard(el, ctx) {
  const { user } = ctx;
  const accts = vault.accountsFor(user);
  const dueSoon = accts.filter((a) => cpm.daysUntilDue(a) < 2).length;
  const drifted = accts.filter((a) => !a.targetSynced).length;
  const open = vault.alerts().filter((a) => a.status === 'open').length;
  const live = psm.liveSessions().length;

  el.innerHTML = `
    <h1>Welcome, ${esc(user.name.split(' ')[0])}</h1>
    <p class="muted" style="margin-top:0">Here's the state of the environment your role can see.</p>
    <div class="tiles" style="margin-bottom:18px">
      ${tile(accts.length, 'Accounts in your safes', '🗝️')}
      ${tile(vault.recordings().length, 'Sessions recorded', '🎥')}
      ${tile(open, 'Open threats', open ? '🚨' : '🛡️')}
      ${tile(dueSoon, 'Rotating within a day', '🔄')}
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr));margin-bottom:18px">
      ${comp('🗄️', 'Vault (EPV)', vault.isUnlocked() ? 'Unlocked · sealing with AES-256' : 'Locked', vault.accounts().length + ' accounts, ' + vault.raw().logs.length + ' log entries', 'ok')}
      ${comp('🖥️', 'PVWA', 'Online', 'The portal you are using now', 'ok')}
      ${comp('🔄', 'CPM', 'Scheduling', drifted ? drifted + ' account(s) drifted — reconcile' : 'All targets in sync', drifted ? 'warn' : 'ok')}
      ${comp('🎥', 'PSM', live ? live + ' live session(s)' : 'Idle', 'Brokers & records connections', 'ok')}
      ${comp('🚨', 'PTA', open ? open + ' open alert(s)' : 'All clear', 'Detect & auto-remediate', open ? 'bad' : 'ok')}
    </div>

    <div class="card">
      <h2>How Keyward fits together</h2>
      <p class="muted small" style="margin-top:0">Four components, one Vault. Remove any one and the workflow breaks.</p>
      <div class="grid" style="grid-template-columns:1fr;gap:8px" class="small">
        ${flow('The Vault is the brain', 'Every credential, policy, log and recording lives here — encrypted. Nothing else stores privileged data.')}
        ${flow('PVWA is the face', 'You log in here (with MFA). It holds no data of its own — it reads from and writes to the Vault on every action.')}
        ${flow('CPM is the hands for passwords', 'Rotates credentials on a schedule so a static password never becomes a standing risk, keeping Vault and target in sync.')}
        ${flow('PSM is the hands for sessions', 'Brokers each connection, injecting the credential without showing it, and records the session for the auditor.')}
        ${flow('PTA is the watchdog', 'Reads the whole event stream and responds to attacks — killing sessions and rotating exposed credentials.')}
      </div>
    </div>`;
}
function tile(n, l, ic) { return `<div class="tile"><span class="ic">${ic}</span><div class="n">${n}</div><div class="l">${l}</div></div>`; }
function comp(ic, name, status, sub, kind) {
  return `<div class="card" style="padding:14px"><div class="row spread"><div class="row" style="gap:8px"><span style="font-size:20px">${ic}</span><b>${name}</b></div><span class="tag ${kind}">${esc(status)}</span></div>
    <div class="tiny faint" style="margin-top:6px">${esc(sub)}</div></div>`;
}
function flow(t, d) { return `<div class="row" style="gap:10px;align-items:flex-start"><span style="color:var(--brand)">▸</span><div><b>${esc(t)}</b> <span class="muted">— ${esc(d)}</span></div></div>`; }
