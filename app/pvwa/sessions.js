/** Keyward PVWA — Sessions: live PSM terminal + Vault-stored recording replay. */
import * as vault from '../vault.js';
import * as psm from '../psm.js';
import { esc, toast, modal } from '../ui.js';
import { fmtSim } from '../clock.js';

let focused = null; // session id currently in the terminal

/** Called from Accounts → opens a brokered session and focuses it. */
export async function focusSession(user, accountId) {
  const s = await psm.connect(user, accountId);
  if (s.denied) return s;
  focused = s.id;
  return s;
}

export function render(el, ctx) {
  const { user } = ctx;
  const live = psm.liveSessions();
  const canAudit = vault.safes().some((s) => vault.can(user, s.id, 'audit'));
  const recs = canAudit ? vault.recordings() : vault.recordings().filter((r) => r.user === user.email);

  const session = focused ? psm.getSession(focused) : live[0] || null;

  el.innerHTML = `
    <h1>Sessions</h1>
    <p class="muted" style="margin-top:0">Every connection is brokered by PSM: the credential is injected without you ever seeing it, the session is isolated, and it is recorded. On disconnect the recording ships to the Vault.</p>
    <div class="grid" style="grid-template-columns: 1.4fr 1fr; align-items:start" id="cols">
      <div class="card" id="live"></div>
      <div class="card" id="recs"></div>
    </div>`;
  if (window.matchMedia('(max-width:900px)').matches) el.querySelector('#cols').style.gridTemplateColumns = '1fr';

  // ---- live terminal ----
  const liveEl = el.querySelector('#live');
  if (!session) {
    liveEl.innerHTML = `<h2>Live session</h2><div class="empty">No active session.<br>Open one from <a href="#/accounts">Accounts → Connect</a>.</div>`;
  } else {
    liveEl.innerHTML = `
      <div class="row spread">
        <h2 style="margin:0"><span class="dot live"></span> ${esc(session.username)}@${esc(session.address)}</h2>
        <button class="btn sm danger" id="disc">Disconnect</button>
      </div>
      <div class="tiny faint" style="margin:4px 0 8px">${esc(session.system)} · brokered for ${esc(session.user)} · credential hidden</div>
      <div class="term" id="term"></div>
      <div class="termbar">
        <input class="input" id="cmd" placeholder="type a command — try whoami, ls, ps, sql, help" autocomplete="off">
        <button class="btn" id="send">Run</button>
      </div>
      <div class="tiny faint" style="margin-top:6px">🔒 The injected password never appears here or in the recording.</div>`;
    const term = liveEl.querySelector('#term');
    const paint = () => {
      term.innerHTML = session.events.map((e) => {
        const cls = e.line.startsWith('──') ? 'sys' : (psm.prompt(session) && e.line.startsWith(psm.prompt(session)) ? 'in' : 'out');
        return `<div class="${cls}">${esc(e.line)}</div>`;
      }).join('');
      term.scrollTop = term.scrollHeight;
    };
    paint();
    const cmd = liveEl.querySelector('#cmd');
    const run = () => { const v = cmd.value; if (!v.trim() && v !== '') { } psm.run(session, v); cmd.value = ''; paint(); };
    liveEl.querySelector('#send').onclick = run;
    cmd.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    cmd.focus();
    liveEl.querySelector('#disc').onclick = async () => {
      const rec = await psm.disconnect(session.id);
      focused = null;
      toast(`Session ended · recording (${rec.events.length} events) archived to the Vault`, 'ok');
      render(el, ctx);
    };
  }

  // ---- recordings ----
  const recsEl = el.querySelector('#recs');
  recsEl.innerHTML = `<h2>Recordings <span class="tag">${recs.length}</span></h2>
    <div class="muted tiny" style="margin-bottom:8px">${canAudit ? 'As an auditor you can replay every session — but never see the credentials used.' : 'Your own sessions.'}</div>
    ${recs.slice().reverse().map((r) => `
      <div class="row spread" style="padding:9px 0;border-bottom:1px solid var(--line)">
        <div><b>${esc(r.username)}@${esc(r.address)}</b><div class="tiny faint">${esc(r.user)} · ${fmtSim(r.start)} · ${r.events.length} events</div></div>
        <button class="btn sm" data-play="${r.id}">▶ Replay</button>
      </div>`).join('') || '<div class="empty">No recordings yet.</div>'}`;
  recsEl.querySelectorAll('[data-play]').forEach((b) => b.onclick = () => replay(b.dataset.play));
}

function replay(recId) {
  const r = vault.getRecording(recId);
  const m = modal(`<div class="row spread"><h2 style="margin:0">▶ ${esc(r.username)}@${esc(r.address)}</h2><button class="btn sm ghost" data-x>Close</button></div>
    <div class="tiny faint" style="margin:4px 0 10px">operator ${esc(r.user)} · ${fmtSim(r.start)} → ${fmtSim(r.end)} · retrieved from Vault storage</div>
    <div class="term" id="rterm"></div>
    <div class="tiny faint" style="margin-top:8px">Auditors review what was done — the credential was never in the stream to begin with.</div>`);
  m.$('[data-x]').onclick = m.close;
  const term = m.$('#rterm');
  let i = 0;
  const step = () => {
    if (i >= r.events.length) return;
    const e = r.events[i++];
    const cls = e.line.startsWith('──') ? 'sys' : (e.line.includes('> ') || e.line.includes('# ') || e.line.includes('SQL>') ? 'in' : 'out');
    const div = document.createElement('div'); div.className = cls; div.textContent = e.line;
    term.appendChild(div); term.scrollTop = term.scrollHeight;
    setTimeout(step, 260);
  };
  step();
}
