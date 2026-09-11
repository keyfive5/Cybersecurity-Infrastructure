/** Runs every Keyward test suite; exits non-zero if any fail. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suites = ['kernel.test.mjs', 'platform.test.mjs'];
let bad = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [join(here, s)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? `\n${bad} suite(s) failed` : '\nAll suites passed ✓');
process.exit(bad ? 1 : 0);
