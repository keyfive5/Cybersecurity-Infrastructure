# Keyward — Privileged Access Management

**A working PAM platform in the browser.** Keyward is an independent, from-scratch
take on the architecture pioneered by tools like CyberArk: an encrypted **Vault**,
a web portal (**PVWA**) with real multi-factor authentication, an automated
password rotator (**CPM**), a session broker and recorder (**PSM**), and live
threat analytics with auto-remediation (**PTA**).

It is not a mock-up. The credentials are sealed with real AES-256-GCM, the MFA is
real RFC 6238 TOTP that enrolls into Google Authenticator/Authy by QR, the audit
log is a tamper-evident hash chain, and the components genuinely cooperate through
an event bus the way the real architecture does. Zero dependencies, zero backend —
it all runs in your browser.

**▶ Live demo:** https://keyfive5.github.io/Cybersecurity-Infrastructure/

> Educational / portfolio project. It models the architecture and security
> workflow of a PAM platform; it is not a production secrets manager.

---

## The five components

| Component | Real name | What it does here |
|---|---|---|
| 🗄️ **Vault** | Enterprise Password Vault | The single source of truth. Every credential, policy, log and recording lives here, sealed with AES-256-GCM under a key derived (PBKDF2, 310k iterations) from the master passphrase. Nothing else stores privileged data. |
| 🖥️ **PVWA** | Password Vault Web Access | The portal you log into. Holds no data of its own — it reads from and writes to the Vault on every action, and shows each user only what their role permits. MFA is layered here. |
| 🔄 **CPM** | Central Policy Manager | Rotates passwords on a schedule so a static credential never becomes a standing risk, setting the new password on the target and in the Vault **together** — and reconciling them if they ever drift apart. |
| 🎥 **PSM** | Privileged Session Manager | Brokers every connection: it injects the credential **without ever showing it to the operator**, isolates and records the session, and ships the recording to the Vault on disconnect for an auditor to replay. |
| 🚨 **PTA** | Privileged Threat Analytics | Watches the whole event stream and alerts on **circumstances, not verbs**. High-severity detections trigger automatic response — kill the live session and rotate the exposed credential. |

## What's genuinely real (not simulated)

- **AES-256-GCM at rest.** Open your browser's storage inspector — every password
  is ciphertext. The master key exists only in memory, only after unlock.
- **RFC 6238 TOTP.** The enrollment QR encodes a real `otpauth://` secret; scan it
  with any authenticator app and the rotating code works. Verified against the
  official RFC 6238 test vectors.
- **Tamper-evident audit log.** An append-only SHA-256 hash chain; editing or
  deleting any entry breaks the integrity check (there's a button to prove it).
- **Role-scoped access.** The DBA sees only databases; the auditor can replay every
  session but can never retrieve a password; only the PAM admin sees everything.
- **The credential is never exposed to a brokered session** — the injected password
  appears nowhere in the live terminal or the stored recording.

## Try it

Everything is pre-seeded as a fictional company, **Northwind Logistics**.

1. **Initialize the Vault** — the master passphrase is pre-filled; this seeds the demo.
2. **Sign in** — pick any demo user (password `Keyward!Demo1` for all):
   - `alice@northwind.co` — **PAM Administrator** (sees everything)
   - `ravi@northwind.co` — **Server Administrator** (Windows + Linux)
   - `sam@northwind.co` — **Database Administrator** (databases only)
   - `dana@northwind.co` — **Security Auditor** (logs & recordings, no credentials)
3. **Set up MFA** — scan the QR, or click *Use current code (demo)* if you have no phone.
4. Explore: connect a **recorded session**, watch **CPM** rotate on the clock, then
   open **Threat Analytics** and fire the **threat range** to watch **PTA** detect and
   auto-remediate a credential used outside the platform.

## Run it locally

Because it uses ES modules, serve it over HTTP (not `file://`):

```bash
npx http-server . -p 8663 -c-1
# then open http://localhost:8663
```

## Tests

Pure Node (uses the platform's own Web Crypto — no dependencies):

```bash
node tests/run.mjs
```

- `tests/kernel.test.mjs` — AES-GCM sealing, PBKDF2, the RFC 6238 TOTP vectors, QR round-trip.
- `tests/platform.test.mjs` — the whole component layer end to end: login, MFA,
  scoped access, rotation + sync + reconcile, PSM recording, PTA detection +
  auto-remediation, and audit-chain tamper detection.

## Deploy the Vault to a server (Windows installer)

Beyond the browser platform, Keyward ships a real **Windows installer** that stands
up the Vault on a VM or cloud instance the way you'd deploy a production Digital Vault.

- **Download:** https://keyfive5.github.io/Cybersecurity-Infrastructure/download.html
  (or `installer/dist/KeywardVault-Setup.zip`)
- **`Setup.exe`** — a wizard (RDP-session check → license → install & safes folders →
  standalone/cluster → operator keys → Remote Control Agent → message bus → hardening →
  Start-menu folder → Master & Administrator passwords), with a one-click **license
  generator** so there's no license server to chase.
- **`KeywardVault.exe`** — a genuine Windows **service** that loads the operator keys,
  validates the license, binds port 1858, and logs its startup like a real vault.
- **`KeywardServerAdmin.exe`** — the **Server Central Administration** console: a
  traffic-light start/stop and the live Date/Time/Message log.

Build it yourself (no SDK needed — uses the C# compiler built into Windows):

```powershell
installer\build.ps1     # compiles the 3 exes and packages installer\dist\KeywardVault-Setup.zip
```

Install silently for testing (elevated):

```
Setup.exe --silent name="You" company="Lab" master="Str0ng!" admin="Str0ng!"
```

Source lives in `installer/src/` (`Common.cs` install engine, `Setup.cs` wizard,
`VaultService.cs` service, `ServerAdmin.cs` console).

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data model, the event
flow between components, and the threat detectors.

```
app/
  crypto.js      AES-GCM, PBKDF2, SHA-256 chain, HMAC-SHA1
  totp.js        RFC 4226/6238 TOTP + otpauth URIs
  qr/            ISO/IEC 18004 QR encoder (for MFA enrollment)
  vault.js       the EPV: state, encryption, permissions, audit chain
  cpm.js         rotation engine + scheduler
  psm.js         session broker + recorder
  pta.js         threat analytics + auto-remediation
  attacks.js     attack simulator (drives the threat range)
  bus.js         event bus   ·   clock.js  business-time clock
  seed.js        the Northwind demo environment
  pvwa/          the portal UI (auth, portal, accounts, sessions, threats, admin)
```

## Credits

Built by **M. Hasan Zafar**. The QR engine is Keyward's own ISO/IEC 18004
implementation (originally written for [QR Forge](https://github.com/keyfive5)).
MIT licensed.
