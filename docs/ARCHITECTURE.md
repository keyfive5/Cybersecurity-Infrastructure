# Keyward architecture

Keyward mirrors the real PAM architecture: **the Vault is the source of truth and
every other component reads from and writes to it**. Nothing else stores privileged
data. Components never call the Vault's storage directly across each other — they
cooperate through an event bus, the same separation the real products enforce.

```
                         ┌──────────────────────────────┐
        sign in + MFA    │            PVWA              │   the only door for
   user ───────────────► │   (portal, holds no data)   │   users and policies
                         └───────┬───────────▲──────────┘
             onboard / policy /  │           │  scoped reads
             connect / reveal    │           │
                                 ▼           │
                         ┌──────────────────────────────┐
                         │           VAULT (EPV)        │  AES-256-GCM at rest
                         │  accounts · safes · policies │  PBKDF2 master key
                         │  users · logs(chain) · recs  │  hash-chained audit
                         └───▲────────▲─────────▲───────┘
              rotate/reconcile│   checkout │      │ save recording
                              │  (hidden)  │      │
                     ┌────────┴───┐  ┌─────┴────┐ │
                     │    CPM     │  │   PSM    │ │
                     │  rotation  │  │ broker + │ │
                     │  scheduler │  │ recorder │ │
                     └────────────┘  └────┬─────┘ │
                              ▲            │ events│
                              │ auto-      ▼       │
                              │ remediate ┌────────┴───┐   listens to the whole
                              └───────────┤    PTA     │◄── event stream
                                          │ analytics  │
                                          └────────────┘
```

## Data model (in the Vault)

All persisted to `localStorage` under `keyward.vault.v1`; every secret field is an
AES-GCM box `{iv, ct}`, never plaintext.

- **users** — `{id, name, email, role, pw:{salt,hash}, mfa:box|null, safes:{safeId:permSet}}`
- **safes** — logical containers that scope access
- **accounts** — `{id, safeId, system, address, platform, username, secret:box, policyId, lastRotated, targetSynced, rotations}`
- **targets** — the simulated machines, each holding its own credential box, so
  Vault↔target sync can be checked and drift demonstrated
- **policies** — `{rotationDays, minLength, complexity}`
- **logs** — append-only hash chain (see below)
- **recordings** — brokered-session transcripts, shipped from PSM on disconnect
- **alerts** — raised by PTA, with remediation steps

## Permissions

Modelled on CyberArk safe-member authorizations. A user's membership in a safe is
a set of booleans: `list`, `use`, `retrieve`, `add`, `manage`, `audit`.

- **list** — see that the account exists
- **use** — connect via PSM (without seeing the password)
- **retrieve** — actually reveal/copy the password
- **add** — onboard new accounts
- **manage** — edit policies
- **audit** — read logs and replay recordings

This is what makes the auditor role meaningful: `list + audit` but **not** `retrieve`
— they can prove what happened without ever seeing a secret.

## The audit hash chain

Each log entry stores `hash = SHA256(prevHash + canonical(entry))`, with the first
linking to `"GENESIS"`. `verifyChain()` recomputes the whole chain; any edit or
deletion changes a hash and every subsequent link fails to match, so tampering is
detectable and localizable to the first broken entry.

Log appends are serialized through a promise queue: because computing the hash is
async, two concurrent `log()` calls could otherwise read the same `prevHash` and
fork the chain. The queue guarantees each append completes before the next begins.

## Credential handling: reveal vs. checkout

Two distinct paths, because they have different security meaning:

- **`revealPassword(user, accountId)`** — an explicit user action. Requires
  `retrieve`, returns the plaintext to display, and emits `vault:reveal` (which PTA
  watches for bulk harvesting).
- **`checkoutForSession(accountId)`** — used only by the PSM broker. Returns the
  credential into the session's private scope to inject it, and it is never rendered
  in the terminal or written into the recording.

## CPM rotation

On each business-time tick the scheduler rotates any account whose
`simTime - lastRotated ≥ policy.rotationDays`. A rotation generates a
policy-compliant password, writes it to **both** the account secret and the target
credential, and stamps `lastRotated`/`targetSynced`. If a target is changed
out-of-band (`desyncTarget`), `checkSync` reports the drift and `reconcile`
force-rotates to bring both sides back together — because if the Vault and the
target disagree, the login breaks.

## PTA detectors

PTA subscribes to the bus and raises alerts on **circumstances, not verbs** — a
lesson from earlier detection work, where matching on privileged verbs floods you
with routine admin activity.

| Detector | Trigger | Severity |
|---|---|---|
| **credential-bypass** | `target:directLogin` — a login to a target that never went through PSM | high |
| **mass-retrieval** | ≥N `vault:reveal` from one user inside a short window | medium |
| **brute-force** | ≥N `auth:fail` against one account in a window | medium |
| **impossible-travel** | two `auth:success` events too far apart, too close in time | medium |
| **off-hours** | `psm:connect` during configured night hours | low |
| **desync** | `cpm:desync` — Vault and target drifted | low |

**Auto-remediation** (toggleable): on a high-severity alert PTA terminates any live
session on the account and tells CPM to rotate the credential, invalidating whatever
the attacker holds. The steps are recorded on the alert and in the audit log — note
that PTA never calls the attack simulator; it only reacts to the resulting events.

## Two clocks, on purpose

- **Wall clock** (`Date.now()`) drives MFA, so TOTP interoperates with real
  authenticator apps.
- **Business-time clock** (`clock.js`) is an accelerated timeline that drives the
  CPM scheduler and timestamps, so rotations that really happen over days can be
  demonstrated in seconds.
