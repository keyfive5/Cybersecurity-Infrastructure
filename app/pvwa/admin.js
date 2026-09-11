/** Keyward PVWA — Administration: safes, policies, users, and the audit log. */
import * as vault from '../vault.js';
import { PERM_LABEL } from '../vault.js';
import { esc, toast, modal } from '../ui.js';
import { fmtSim } from '../clock.js';

export function render(el, ctx) {
  const { user } = ctx;
  const isAdmin = vault.safes().some((s) => vault.can(user, s.id, 'manage'));
  const canAudit = vault.safes().some((s) => vault.can(user, s.id, 'audit'));

  el.innerHTML = `
    <h1>Administration</h1>
    <div class="row wrap" style="gap:8px;margin-bottom:16px" id="tabs">
      ${isAdmin ? '<button class="btn sm" data-tab="policies">Policies</button><button class="btn sm" data-tab="safes">Safes & users</button>' : ''}
      ${canAudit ? '<button class="btn sm" data-tab="audit">Audit log</button>' : ''}
    </div>
    <div id="panel"></div>`;

  const panel = el.querySelector('#panel');
  const tabs = { policies: () => policies(panel, user), safes: () => safes(panel), audit: () => audit(panel) };
  const show = (t) => { el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('primary', b.dataset.tab === t)); tabs[t](); };
  el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => show(b.dataset.tab));
  show(isAdmin ? 'policies' : 'audit');
}

function policies(panel, user) {
  panel.innerHTML = `<div class="card"><div class="row spread"><h2 style="margin:0">Rotation policies</h2></div>
    <div class="muted small" style="margin-bottom:10px">Policies live in the Vault. CPM reads them to decide when and how to rotate.</div>
    <div class="t-scroll"><table><thead><tr><th>Policy</th><th>Rotate every</th><th>Min length</th><th>Complexity</th><th>Accounts</th></tr></thead><tbody>
    ${vault.policies().map((p) => `<tr>
      <td><b>${esc(p.name)}</b></td>
      <td>${p.rotationDays} day${p.rotationDays === 1 ? '' : 's'}</td>
      <td>${p.minLength}</td>
      <td class="tiny">${Object.keys(p.complexity || {}).filter((k) => p.complexity[k]).join(', ')}</td>
      <td>${vault.accounts().filter((a) => a.policyId === p.id).length}</td>
    </tr>`).join('')}</tbody></table></div></div>`;
}

function safes(panel) {
  panel.innerHTML = `<div class="grid" style="grid-template-columns:1fr 1fr">
    <div class="card"><h2>Safes</h2>${vault.safes().map((s) => `
      <div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${esc(s.name)}</b>
        <div class="tiny faint">${esc(s.desc)} · ${vault.accountsInSafe(s.id).length} accounts</div></div>`).join('')}</div>
    <div class="card"><h2>Users & reach</h2>${vault.users().map((u) => {
      const memberOf = vault.safes().filter((s) => u.safes?.[s.id]?.list);
      return `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div class="row spread"><b>${esc(u.name)}</b><span class="tag">${esc(u.role)}</span></div>
        <div class="tiny faint">${esc(u.email)} · MFA ${vault.hasMfa(u.id) ? '<span class="sev-low">enrolled</span>' : 'not set'}</div>
        <div class="tiny" style="margin-top:4px">${memberOf.map((s) => `<span class="tag" style="margin:2px">${esc(s.name.split(' ')[0])}: ${permSummary(u.safes[s.id])}</span>`).join('')}</div>
      </div>`;
    }).join('')}</div></div>`;
}
function permSummary(m) { return Object.keys(m).filter((k) => m[k]).map((k) => k[0]).join('').toUpperCase(); }

async function audit(panel) {
  const logs = vault.raw().logs;
  panel.innerHTML = `<div class="card">
    <div class="row spread wrap"><h2 style="margin:0">Audit log <span class="tag">${logs.length} entries</span></h2>
      <button class="btn sm key" id="verify">🔗 Verify chain integrity</button></div>
    <div class="muted small" style="margin:6px 0 10px">Append-only hash chain — each entry commits to the previous one. Editing or deleting any record breaks verification.</div>
    <div id="vres"></div>
    <div class="t-scroll" style="max-height:520px;overflow:auto"><table><thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead><tbody>
    ${logs.slice().reverse().map((e) => `<tr>
      <td class="mono tiny faint">${e.seq}</td>
      <td class="tiny">${fmtSim(e.ts)}</td>
      <td class="small">${esc(e.actor)}</td>
      <td><span class="tag ${actionClass(e.action)}">${esc(e.action)}</span></td>
      <td class="small">${esc(e.detail)}</td>
    </tr>`).join('')}</tbody></table></div></div>`;
  panel.querySelector('#verify').onclick = async () => {
    const res = await vault.verifyChain();
    panel.querySelector('#vres').innerHTML = res.ok
      ? `<div class="banner" style="border-color:#1e5b48;background:#0c2119;color:#8ff0c9">✓ Chain intact — all ${logs.length} entries verify against their predecessors.</div>`
      : `<div class="banner warn">✗ Chain broken at entry #${res.brokenAt} — a record was altered or removed.</div>`;
  };
}
function actionClass(a) {
  if (['rotate', 'reconcile', 'onboard'].includes(a)) return 'ok';
  if (['alert', 'desync', 'retrieve-denied', 'connect-denied'].includes(a)) return 'warn';
  if (['remediate'].includes(a)) return 'bad';
  return '';
}
