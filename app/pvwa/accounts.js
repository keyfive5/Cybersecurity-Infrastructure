/** Keyward PVWA — Accounts: scoped browse, onboard, reveal, connect, rotate. */
import * as vault from '../vault.js';
import * as cpm from '../cpm.js';
import { focusSession } from './sessions.js';
import { esc, toast, modal, confirmModal } from '../ui.js';
import { fmtSim } from '../clock.js';

function syncTag(a) {
  return a.targetSynced
    ? '<span class="tag ok">● in sync</span>'
    : '<span class="tag bad">● drifted</span>';
}
function dueTag(a) {
  const d = cpm.daysUntilDue(a);
  if (d === Infinity) return '<span class="tag">no policy</span>';
  if (d <= 0) return '<span class="tag warn">rotating…</span>';
  return `<span class="tag">next rotation ${d < 1 ? '<1' : Math.ceil(d)}d</span>`;
}

export function render(el, ctx) {
  const { user } = ctx;
  const safes = vault.safesFor(user);
  if (!safes.length) { el.innerHTML = `<div class="empty">You have no safe memberships. Ask a PAM administrator for access.</div>`; return; }

  el.innerHTML = `
  <div class="row spread wrap" style="margin-bottom:16px">
    <div><h1>Accounts</h1><p class="muted" style="margin:0">You see only the safes your role is a member of — ${safes.length} of ${vault.safes().length}.</p></div>
  </div>
  <div class="grid" id="safes"></div>`;

  const host = el.querySelector('#safes');
  for (const safe of safes) {
    const accts = vault.accountsInSafe(safe.id);
    const canAdd = vault.can(user, safe.id, 'add');
    const canUse = vault.can(user, safe.id, 'use');
    const canRetrieve = vault.can(user, safe.id, 'retrieve');
    const canManage = vault.can(user, safe.id, 'manage') || canAdd;

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="row spread wrap">
        <div><h2 style="margin:0">🗄️ ${esc(safe.name)}</h2><div class="muted small">${esc(safe.desc)}</div></div>
        ${canAdd ? `<button class="btn sm key" data-onboard="${safe.id}">＋ Onboard account</button>` : ''}
      </div>
      <div class="t-scroll" style="margin-top:12px"><table>
        <thead><tr><th>Account</th><th>System</th><th>Address</th><th>Rotation</th><th></th></tr></thead>
        <tbody>
        ${accts.map((a) => `<tr>
          <td><b>${esc(a.username)}</b><div class="tiny faint">${esc(a.platform)} · rotated ${a.rotations}×</div></td>
          <td>${esc(a.system)}</td>
          <td class="mono small">${esc(a.address)}</td>
          <td>${syncTag(a)} ${dueTag(a)}</td>
          <td><div class="row" style="justify-content:flex-end;gap:6px">
            ${canUse ? `<button class="btn sm primary" data-connect="${a.id}">Connect</button>` : ''}
            ${canRetrieve ? `<button class="btn sm" data-reveal="${a.id}">Reveal</button>` : ''}
            ${canManage ? `<button class="btn sm ghost" data-rotate="${a.id}">Rotate</button>` : ''}
            ${!canUse && !canRetrieve ? '<span class="tiny faint">list-only</span>' : ''}
          </div></td>
        </tr>`).join('') || `<tr><td colspan="5" class="empty">No accounts in this safe yet.</td></tr>`}
        </tbody></table></div>`;
    host.appendChild(card);
  }

  // ---- actions ----
  el.querySelectorAll('[data-connect]').forEach((b) => b.onclick = async () => {
    const acct = vault.getAccount(b.dataset.connect);
    const res = await focusSession(user, acct.id);
    if (res?.denied) { toast('Connection denied — you lack <b>Use</b> on this safe.', 'bad'); return; }
    ctx.go('sessions');
  });

  el.querySelectorAll('[data-reveal]').forEach((b) => b.onclick = async () => {
    const res = await vault.revealPassword(user, b.dataset.reveal);
    if (res.denied) { toast('Retrieval denied — your role does not permit revealing this password.', 'bad'); return; }
    const acct = vault.getAccount(b.dataset.reveal);
    let left = 20;
    const m = modal(`<h2>🔑 Password revealed</h2>
      <p class="muted small">${esc(acct.username)}@${esc(acct.address)} — this retrieval is written to the audit log. PTA watches for bulk retrieval.</p>
      <div class="codebox" style="letter-spacing:2px;font-size:20px" id="pw">${esc(res.password)}</div>
      <div class="row" style="justify-content:space-between;margin-top:12px">
        <span class="tiny faint">auto-hides in <b id="cd">${left}</b>s</span>
        <div class="row"><button class="btn sm" id="copy">Copy</button><button class="btn sm ghost" data-x>Close</button></div>
      </div>`);
    m.$('#copy').onclick = () => { navigator.clipboard?.writeText(res.password); toast('Copied to clipboard', 'ok'); };
    m.$('[data-x]').onclick = m.close;
    const iv = setInterval(() => { left--; const cd = m.$('#cd'); if (!cd) { clearInterval(iv); return; } cd.textContent = left; if (left <= 0) { clearInterval(iv); m.close(); } }, 1000);
  });

  el.querySelectorAll('[data-rotate]').forEach((b) => b.onclick = async () => {
    const acct = vault.getAccount(b.dataset.rotate);
    if (!await confirmModal('Rotate now?', `CPM will generate a new password for <b>${esc(acct.username)}@${esc(acct.address)}</b>, set it on the target, and update the Vault together.`, 'Rotate')) return;
    await cpm.rotate(acct.id, user.email + ' (manual)');
    toast('Rotated ✓ — Vault and target updated together', 'ok');
    render(el, ctx);
  });

  el.querySelectorAll('[data-onboard]').forEach((b) => b.onclick = () => onboardForm(b.dataset.onboard, user, () => render(el, ctx)));
}

function onboardForm(safeId, user, done) {
  const pols = vault.policies();
  const m = modal(`<h2>Onboard a privileged account</h2>
    <p class="muted small">Defined here in PVWA and written back to the Vault. The target machine is provisioned with the same credential.</p>
    <div class="field"><label>System</label><input class="input" id="o-system" placeholder="e.g. Windows Server 2022"></div>
    <div class="row"><div class="field" style="flex:1"><label>Address / host</label><input class="input" id="o-addr" placeholder="10.4.1.99"></div>
      <div class="field" style="flex:1"><label>Platform</label><input class="input" id="o-plat" placeholder="Windows Local"></div></div>
    <div class="row"><div class="field" style="flex:1"><label>Username</label><input class="input" id="o-user" placeholder="Administrator"></div>
      <div class="field" style="flex:1"><label>Current password</label><input class="input" id="o-pw" placeholder="known password to onboard"></div></div>
    <div class="field"><label>Rotation policy</label><select class="input" id="o-pol">
      <option value="">— none —</option>${pols.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn ghost" data-x>Cancel</button><button class="btn key" id="save">Onboard →</button></div>
    <div id="oerr" class="small" style="color:var(--bad);margin-top:8px"></div>`);
  m.$('[data-x]').onclick = m.close;
  m.$('#save').onclick = async () => {
    const g = (id) => m.$('#' + id).value.trim();
    if (!g('o-system') || !g('o-addr') || !g('o-user') || !g('o-pw')) { m.$('#oerr').textContent = 'All fields except policy are required.'; return; }
    await vault.addAccount({ safeId, system: g('o-system'), address: g('o-addr'), platform: g('o-plat') || 'Generic', username: g('o-user'), password: g('o-pw'), policyId: g('o-pol') || null }, user.email);
    m.close(); toast('Account onboarded and sealed in the Vault ✓', 'ok'); done();
  };
}
