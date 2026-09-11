/**
 * Keyward PVWA — authentication.
 *
 * Two layers, both real:
 *   1. Vault unlock — the master passphrase that derives the AES key. Without
 *      it the Vault is ciphertext and nothing works.
 *   2. User sign-in — email + password, then MFA. MFA is genuine RFC 6238:
 *      first sign-in enrols by scanning a QR into any authenticator app; after
 *      that a rotating code is required. (A "use current code" button lets a
 *      demo viewer without a phone still get in.)
 */
import * as vault from '../vault.js';
import { totp, verifyTotp, generateSecret, otpauthURI, secondsRemaining } from '../totp.js';
import { emit } from '../bus.js';
import { qrSvg, esc, toast } from '../ui.js';
import { seedIfEmpty, DEMO_PASSWORD } from '../seed.js';

const ISSUER = 'Keyward';
const DEMO_VAULT_PASS = 'keyward-master';
const HOME = { city: 'Toronto', lat: 43.65, lon: -79.38 };

export function renderBoot(root, onReady) {
  const initialized = vault.isInitialized();
  root.innerHTML = `
  <div class="auth"><div class="authcard">
    <div class="brand" style="justify-content:center;margin-bottom:8px">
      <div class="mark">K</div><b>Keyward</b>
    </div>
    <div class="card">
      <h1 style="text-align:center">${initialized ? 'Unlock the Vault' : 'Initialize the Vault'}</h1>
      <p class="muted small" style="text-align:center">
        ${initialized
          ? 'Enter the master passphrase to derive the encryption key and bring the platform online.'
          : 'Set the Vault master passphrase. It derives the AES-256 key that seals every credential — it is never stored, only its verifier is.'}
      </p>
      <div class="field"><label>Master passphrase</label>
        <input class="input" id="vpass" type="password" value="${DEMO_VAULT_PASS}" autocomplete="off"></div>
      <button class="btn primary" id="vgo" style="width:100%">${initialized ? '🔓 Unlock' : '⚙️ Initialize & seed demo'}</button>
      <div id="verr" class="small" style="color:var(--bad);margin-top:8px;text-align:center"></div>
      <p class="tiny faint" style="text-align:center;margin-top:14px">Demo passphrase is pre-filled. Everything runs locally in your browser.</p>
    </div>
  </div></div>`;

  const go = async () => {
    const pass = root.querySelector('#vpass').value;
    const err = root.querySelector('#verr');
    root.querySelector('#vgo').disabled = true;
    try {
      if (initialized) {
        if (!(await vault.unlock(pass))) { err.textContent = 'Wrong passphrase — the key does not decrypt the Vault.'; root.querySelector('#vgo').disabled = false; return; }
      } else {
        await vault.bootstrap(pass);
        await seedIfEmpty();
      }
      onReady();
    } catch (e) { err.textContent = e.message; root.querySelector('#vgo').disabled = false; }
  };
  root.querySelector('#vgo').onclick = go;
  root.querySelector('#vpass').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

export function renderLogin(root, onEnter) {
  const demoUsers = vault.users();
  root.innerHTML = `
  <div class="auth"><div class="authcard">
    <div class="brand" style="justify-content:center;margin-bottom:8px"><div class="mark">K</div><b>Keyward</b></div>
    <div class="card">
      <h1 style="text-align:center">Sign in</h1>
      <p class="muted small" style="text-align:center">Password Vault Web Access</p>
      <div class="field"><label>Email</label><input class="input" id="email" value="alice@northwind.co"></div>
      <div class="field"><label>Password</label><input class="input" id="pw" type="password" value="${DEMO_PASSWORD}"></div>
      <button class="btn primary" id="login" style="width:100%">Continue →</button>
      <div id="lerr" class="small" style="color:var(--bad);margin-top:8px;text-align:center"></div>
      <hr class="hr"><div class="tiny muted">Demo accounts — password <code class="pw">${esc(DEMO_PASSWORD)}</code> for all:</div>
      <div class="demo-users">
        ${demoUsers.map((u) => `<button class="btn sm ghost" data-email="${esc(u.email)}"><b>${esc(u.name)}</b> · <span class="muted">${esc(u.role)}</span></button>`).join('')}
      </div>
    </div>
  </div></div>`;

  root.querySelectorAll('[data-email]').forEach((b) => b.onclick = () => { root.querySelector('#email').value = b.dataset.email; });

  const attempt = async () => {
    const email = root.querySelector('#email').value.trim();
    const pw = root.querySelector('#pw').value;
    const err = root.querySelector('#lerr');
    err.textContent = '';
    const user = await vault.verifyLogin(email, pw);
    if (!user) {
      err.textContent = 'Invalid email or password.';
      const known = vault.findUser(email);
      if (known) {
        const acct = vault.accountsFor(known)[0];
        if (acct) emit('auth:fail', { accountId: acct.id, who: email });
      }
      return;
    }
    mfaStep(root, user, onEnter);
  };
  root.querySelector('#login').onclick = attempt;
  root.querySelector('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
}

async function mfaStep(root, user, onEnter) {
  const enrolled = vault.hasMfa(user.id);
  let secret = enrolled ? await vault.getMfaSecret(user.id) : generateSecret();
  const uri = otpauthURI({ issuer: ISSUER, account: user.email, secret });

  root.innerHTML = `
  <div class="auth"><div class="authcard">
    <div class="brand" style="justify-content:center;margin-bottom:8px"><div class="mark">K</div><b>Keyward</b></div>
    <div class="card">
      <h1 style="text-align:center">${enrolled ? 'Two-factor authentication' : 'Set up two-factor'}</h1>
      <p class="muted small" style="text-align:center">${esc(user.name)} · ${esc(user.email)}</p>
      ${enrolled ? '' : `
        <p class="small muted" style="text-align:center">Scan with Google Authenticator, Authy, 1Password — any TOTP app. This QR encodes a real <span class="mono">otpauth://</span> secret.</p>
        <div style="text-align:center;margin:14px 0">${qrSvg(uri, { scale: 5 })}</div>
        <div class="tiny faint" style="text-align:center;word-break:break-all">secret: <span class="mono">${esc(secret)}</span></div>`}
      <div class="field" style="margin-top:16px"><label>6-digit code</label>
        <input class="input codebox" id="code" maxlength="6" inputmode="numeric" placeholder="••••••"></div>
      <div class="row" style="justify-content:space-between;margin-bottom:10px">
        <button class="btn sm ghost" id="usecode">⌚ Use current code (demo)</button>
        <div class="row"><div class="ring" id="ring"><span id="secs"></span></div></div>
      </div>
      <button class="btn primary" id="verify" style="width:100%">${enrolled ? 'Verify & sign in' : 'Verify & enable MFA'}</button>
      <div id="merr" class="small" style="color:var(--bad);margin-top:8px;text-align:center"></div>
      <button class="btn ghost sm" id="back" style="width:100%;margin-top:10px">← Back</button>
    </div>
  </div></div>`;

  const tick = async () => {
    const s = secondsRemaining(30);
    const ring = root.querySelector('#ring'); const secsEl = root.querySelector('#secs');
    if (!ring) return; // navigated away
    ring.style.setProperty('--p', ((30 - s) / 30) * 100);
    secsEl.textContent = s;
  };
  tick();
  const timer = setInterval(tick, 1000);

  root.querySelector('#usecode').onclick = async () => { root.querySelector('#code').value = await totp(secret); };
  root.querySelector('#back').onclick = () => { clearInterval(timer); renderLogin(root, onEnter); };
  root.querySelector('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') root.querySelector('#verify').click(); });

  root.querySelector('#verify').onclick = async () => {
    const code = root.querySelector('#code').value.replace(/\s/g, '');
    if (!(await verifyTotp(secret, code))) { root.querySelector('#merr').textContent = 'Incorrect or expired code — try the current one.'; return; }
    clearInterval(timer);
    if (!enrolled) { await vault.enrollMfa(user.id, secret); toast('MFA enrolled ✓', 'ok'); }
    await vault.log(user.email, 'login', `Signed in via PVWA with MFA`);
    emit('auth:success', { user: user.email, geo: HOME });
    emit('psm:connect-context', {}); // noop hook
    onEnter(user);
  };
}
