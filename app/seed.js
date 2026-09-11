/**
 * Keyward — demo enterprise ("Northwind Logistics").
 *
 * Seeds a believable environment so the platform is alive on first load:
 * four safes, three rotation policies, four people with different roles and
 * deliberately different reach, and a spread of privileged accounts. The role
 * design shows off the architecture: the auditor can see logs but no
 * credentials, the DBA sees only databases, and only the PAM admin sees all.
 */
import * as vault from './vault.js';

export const DEMO_PASSWORD = 'Keyward!Demo1';

const ALL = { list: true, use: true, retrieve: true, add: true, manage: true, audit: true };
const USE = { list: true, use: true, retrieve: true, add: true };  // operate, no policy mgmt
const AUDIT = { list: true, audit: true };                          // see it happened, not the secret

export async function seedIfEmpty() {
  if (vault.safes().length) return false;

  const win = vault.addSafe({ name: 'Windows Servers', desc: 'Domain controllers and member servers' });
  const lin = vault.addSafe({ name: 'Linux Infrastructure', desc: 'RHEL / Ubuntu hosts' });
  const db = vault.addSafe({ name: 'Databases', desc: 'SQL Server & Oracle service accounts' });
  const net = vault.addSafe({ name: 'Network Devices', desc: 'Switches, routers, firewalls' });

  const daily = vault.addPolicy({ name: 'Critical — 1 day', rotationDays: 1, minLength: 20, complexity: { lower: true, upper: true, digits: true, symbols: true } });
  const weekly = vault.addPolicy({ name: 'Standard — 7 day', rotationDays: 7, minLength: 16, complexity: { lower: true, upper: true, digits: true, symbols: true } });
  const monthly = vault.addPolicy({ name: 'Low-risk — 30 day', rotationDays: 30, minLength: 14, complexity: { lower: true, upper: true, digits: true } });

  // people
  await vault.addUser({ name: 'Alice Chen', email: 'alice@northwind.co', role: 'PAM Administrator', password: DEMO_PASSWORD,
    safes: { [win.id]: ALL, [lin.id]: ALL, [db.id]: ALL, [net.id]: ALL } });
  await vault.addUser({ name: 'Ravi Patel', email: 'ravi@northwind.co', role: 'Server Administrator', password: DEMO_PASSWORD,
    safes: { [win.id]: USE, [lin.id]: USE } });
  await vault.addUser({ name: 'Sam Ortiz', email: 'sam@northwind.co', role: 'Database Administrator', password: DEMO_PASSWORD,
    safes: { [db.id]: USE } });
  await vault.addUser({ name: 'Dana Kim', email: 'dana@northwind.co', role: 'Security Auditor', password: DEMO_PASSWORD,
    safes: { [win.id]: AUDIT, [lin.id]: AUDIT, [db.id]: AUDIT, [net.id]: AUDIT } });

  // privileged accounts (password is the current secret; it gets rotated away fast)
  const acc = (o) => vault.addAccount(o, 'seed');
  await acc({ safeId: win.id, system: 'Windows Server 2022', address: '10.4.1.5', platform: 'Windows Domain', username: 'NORTHWIND\\Administrator', password: 'W!nterDC-2026#a', policyId: daily.id });
  await acc({ safeId: win.id, system: 'Windows Server 2022', address: '10.4.1.10', platform: 'Windows Local', username: 'Administrator', password: 'L0calAdmin-77x', policyId: weekly.id });
  await acc({ safeId: win.id, system: 'Windows Server 2019', address: '10.4.1.11', platform: 'Windows Service', username: 'svc_backup', password: 'Backup$vc-903', policyId: monthly.id });
  await acc({ safeId: lin.id, system: 'RHEL 9', address: '10.4.2.20', platform: 'Unix SSH', username: 'root', password: 'r00t-rhel-Aa1', policyId: weekly.id });
  await acc({ safeId: lin.id, system: 'Ubuntu 24.04', address: '10.4.2.21', platform: 'Unix SSH', username: 'root', password: 'r00t-ubu-Bb2', policyId: weekly.id });
  await acc({ safeId: db.id, system: 'SQL Server 2022', address: '10.4.3.30', platform: 'MSSQL', username: 'sa', password: 'S@Server-db01', policyId: daily.id });
  await acc({ safeId: db.id, system: 'Oracle 19c', address: '10.4.3.31', platform: 'Oracle', username: 'SYSTEM', password: '0racle-sys-99', policyId: weekly.id });
  await acc({ safeId: net.id, system: 'Cisco IOS', address: '10.4.4.40', platform: 'Network', username: 'admin', password: 'C1sco-core-x', policyId: monthly.id });

  await vault.log('system', 'seed', 'Seeded demo environment "Northwind Logistics" (4 safes, 8 accounts, 4 users)');
  return true;
}
