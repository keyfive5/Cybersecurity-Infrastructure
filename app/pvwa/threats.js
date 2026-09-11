/** Keyward PVWA — Threats: PTA alert console, attack range, auto-remediation. */
import * as vault from '../vault.js';
import * as pta from '../pta.js';
import * as attacks from '../attacks.js';
import { on } from '../bus.js';
import { esc, toast, relTime } from '../ui.js';
import { fmtSim } from '../clock.js';

let unsub = [];

export function render(el, ctx) {
  const { user } = ctx;
  unsub.forEach((u) => u()); unsub = [];
  const accts = vault.accountsFor(user);

  el.innerHTML = `
    <div class="row spread wrap"><h1>Threat Analytics (PTA)</h1>
      <label class="row" style="gap:8px"><input type="checkbox" id="auto" ${pta.config.autoRemediate ? 'checked' : ''}>
        <span class="small">Auto-remediation</span></label></div>
    <p class="muted" style="margin-top:0">PTA watches the whole event stream and alerts on <b>circumstances, not verbs</b>. High-severity detections trigger automatic response — kill the session, rotate the exposed credential.</p>

    <div class="tiles" id="tiles" style="margin-bottom:16px"></div>

    <div class="card" style="margin-bottom:16px">
      <h2>⚔️ Threat range <span class="tag warn">simulation</span></h2>
      <p class="muted small">Fire a realistic attack. PTA is only listening to the resulting events — nothing here calls it directly.</p>
      <div class="field" style="max-width:420px"><label>Target account</label>
        <select class="input" id="tgt">${accts.map((a) => `<option value="${a.id}">${esc(a.username)}@${esc(a.address)} · ${esc(a.system)}</option>`).join('')}</select></div>
      <div class="row wrap">
        <button class="btn danger" data-atk="bypass">🎭 Use credential outside Keyward</button>
        <button class="btn" data-atk="brute">🔨 Brute-force logins</button>
        <button class="btn" data-atk="travel">✈️ Impossible travel</button>
        <button class="btn" data-atk="mass">📥 Bulk credential retrieval</button>
        <button class="btn" data-atk="desync">🔀 Out-of-band password change</button>
      </div>
    </div>

    <div class="card"><div class="row spread"><h2 style="margin:0">Alerts</h2>
      <button class="btn sm ghost" id="clear">Clear resolved</button></div>
      <div id="feed" style="margin-top:12px"></div></div>`;

  el.querySelector('#auto').onchange = (e) => { pta.config.autoRemediate = e.target.checked; toast(`Auto-remediation ${e.target.checked ? 'on' : 'off'}`, 'ok'); };

  const tgt = () => el.querySelector('#tgt').value;
  const atk = {
    bypass: () => { attacks.directLogin(tgt()); toast('Direct login fired — watch PTA respond', 'warn'); },
    brute: () => { attacks.bruteForce(tgt(), 6); toast('6 failed logins fired', 'warn'); },
    travel: () => { attacks.impossibleTravel(user.email); toast('Two far-apart logins fired', 'warn'); },
    mass: () => { attacks.massRetrieve('mallory@northwind.co', accts.slice(0, 5)); toast('Bulk retrieval fired', 'warn'); },
    desync: () => { attacks.outOfBandChange(tgt()); toast('Target changed out-of-band', 'warn'); },
  };
  el.querySelectorAll('[data-atk]').forEach((b) => b.onclick = atk[b.dataset.atk]);
  el.querySelector('#clear').onclick = () => { vault.alerts().filter((a) => a.status !== 'open').forEach((a) => vault.updateAlert(a.id, { hidden: true })); paint(); };

  const tiles = el.querySelector('#tiles');
  const feed = el.querySelector('#feed');
  const paint = () => {
    const open = vault.alerts().filter((a) => a.status === 'open');
    const rem = vault.alerts().filter((a) => a.status === 'remediated');
    const bySev = (s) => vault.alerts().filter((a) => a.severity === s && a.status === 'open').length;
    tiles.innerHTML = `
      ${tile(open.length, 'Open alerts', '🚨')}
      ${tile(bySev('high'), 'High severity', '🔴')}
      ${tile(rem.length, 'Auto-remediated', '🛡️')}
      ${tile(vault.recordings().length, 'Sessions recorded', '🎥')}`;
    const list = vault.alerts().filter((a) => !a.hidden).slice().reverse();
    feed.innerHTML = list.map((a) => `
      <div class="alert ${a.status === 'remediated' ? 'remediated' : ''}">
        <div class="sevbar ${a.severity}"></div>
        <div style="flex:1">
          <div class="row spread"><b class="sev-${a.severity}">${esc(a.title)}</b>
            <span class="tiny faint">${relTime(a.ts <= Date.now() ? a.ts : Date.now())}</span></div>
          <div class="small" style="margin:3px 0">${esc(a.detail)}</div>
          <div class="row wrap" style="gap:6px">
            <span class="tag">${esc(a.type)}</span>
            <span class="tag ${a.severity === 'high' ? 'bad' : a.severity === 'medium' ? 'warn' : ''}">${esc(a.severity)}</span>
            ${a.status === 'remediated'
              ? `<span class="tag ok">🛡️ remediated: ${esc((a.remediation || []).join('; '))}</span>`
              : `<button class="btn sm ghost" data-ack="${a.id}">Acknowledge</button>`}
          </div>
        </div>
      </div>`).join('') || '<div class="empty">No alerts. Fire something from the threat range above.</div>';
    feed.querySelectorAll('[data-ack]').forEach((b) => b.onclick = () => { vault.updateAlert(b.dataset.ack, { status: 'acknowledged' }); paint(); });
  };
  paint();

  // live updates while this view is mounted
  ['pta:alert', 'pta:alert-update', 'pta:remediated', 'cpm:rotated'].forEach((ev) => unsub.push(on(ev, () => paint())));
}

function tile(n, l, ic) { return `<div class="tile"><span class="ic">${ic}</span><div class="n">${n}</div><div class="l">${l}</div></div>`; }
