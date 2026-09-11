/** Keyward — application bootstrap. */
import * as vault from './vault.js';
import * as cpm from './cpm.js';
import * as pta from './pta.js';
import * as clock from './clock.js';
import { renderBoot, renderLogin } from './pvwa/auth.js';
import { mountPortal } from './pvwa/portal.js';

const app = document.getElementById('app');

// engines run for the life of the page
vault.load();
clock.start();
cpm.startScheduler();
pta.start();

function boot() {
  // Layer 1: unlock / initialize the Vault.
  if (!vault.isUnlocked()) {
    renderBoot(app, () => login());
    return;
  }
  login();
}

function login() {
  // Layer 2: PVWA user sign-in + MFA.
  renderLogin(app, (user) => {
    mountPortal(app, user, {
      onSignOut: () => login(),
      onLock: () => { vault.lock(); boot(); },
    });
  });
}

boot();

// expose a reset for the demo (also available as a link on the boot screen)
window.__keywardReset = () => { vault.wipe(); location.reload(); };
