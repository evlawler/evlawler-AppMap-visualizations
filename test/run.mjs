// Minimal, dependency-free test: run the generator on the bundled fixtures and assert
// the before/after facts and the CI exit code. Run with: npm test  (or: node test/run.mjs)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '..', 'bin', 'appmap-diff-mermaid.mjs');
const base = join(here, 'fixtures', 'base.appmap.json');
const head = join(here, 'fixtures', 'head.appmap.json');

let out = '';
let code = 0;
try {
  out = execFileSync('node', [bin, base, head, '--name', 'demo_flow'], { encoding: 'utf8' });
} catch (e) {
  // Generator exits 1 when a break is detected — that is expected here.
  out = e.stdout ? e.stdout.toString() : '';
  code = e.status ?? 1;
}

const checks = [
  ['exit code is 1 (break detected)', code === 1],
  ['reports 200 -> 403', /200 → 403|200 -> 403/.test(out) || out.includes('200 → 403')],
  ['before diagram runs the SQL query', out.includes('SELECT thing')],
  ['after diagram drops the SQL query', out.split('## After')[1] ? !out.split('## After')[1].split('## What changed')[0].includes('SELECT thing') : false],
  ['after diagram shows the thrown exception', /throws (HaltException|SignatureException)/.test(out)],
  ['has two mermaid blocks', (out.match(/```mermaid/g) || []).length === 2],
  ['names the dropped downstream step', out.includes('SELECT thing') && /no longer runs/.test(out)],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${name}`);
  if (!ok) failed++;
}
if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log(`\nAll ${checks.length} checks passed.`);
