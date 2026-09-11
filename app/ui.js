/** Keyward — shared UI helpers. */
import { encodeText } from './qr/encode.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Render a string to a crisp, scannable QR SVG (dark on white, with quiet zone). */
export function qrSvg(text, { scale = 5, quiet = 4 } = {}) {
  const qr = encodeText(text, { ecLevel: 'M' });
  const n = qr.size, dim = (n + quiet * 2) * scale;
  let rects = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules[r * n + c]) {
        rects += `<rect x="${(c + quiet) * scale}" y="${(r + quiet) * scale}" width="${scale}" height="${scale}"/>`;
      }
    }
  }
  return `<svg class="qr" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${dim}" height="${dim}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

let toastWrap;
export function toast(msg, kind = '', ms = 3200) {
  if (!toastWrap) { toastWrap = document.createElement('div'); toastWrap.className = 'toast-wrap'; document.body.appendChild(toastWrap); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = msg;
  toastWrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, ms);
}

export function modal(html) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal card">${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  const close = () => bg.remove();
  document.body.appendChild(bg);
  return { el: bg, close, $: (s) => bg.querySelector(s) };
}

export function confirmModal(title, body, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const m = modal(`<h2>${esc(title)}</h2><div class="muted" style="margin-bottom:16px">${body}</div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn ghost" data-x>Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`);
    m.$('[data-x]').onclick = () => { m.close(); resolve(false); };
    m.$('[data-ok]').onclick = () => { m.close(); resolve(true); };
  });
}

export function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function sevClass(sev) { return 'sev-' + sev; }
