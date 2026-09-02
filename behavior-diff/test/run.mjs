// Dependency-free test for the consolidated behavior-diff. Runs the tool on the
// bundled sequence-export fixtures and asserts the diff facts, label-awareness,
// unchanged-collapse, and the CI exit codes. Run: node test/run.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "behavior-diff.mjs");
const base = join(here, "fixtures", "baseline.sequence.json");
const cur = join(here, "fixtures", "current.sequence.json");

function run(args) {
  try {
    return { code: 0, out: execFileSync("node", [bin, ...args], { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString() };
  }
}

const ascii = run([base, cur, "--format", "ascii"]);
const ba = run([base, cur, "--format", "before-after"]);
const merm = run([base, cur, "--format", "mermaid"]);
const same = run([base, base, "--format", "ascii"]);
const beforeBlock = ba.out.split("### After")[0];
const afterBlock = ba.out.split("### After")[1] ?? "";

const checks = [
  ["change detected → exit 1", ascii.code === 1],
  ["identical inputs → exit 0", same.code === 0],
  ["identical inputs say so", /No runtime behavior changed/.test(same.out)],
  ["honest tally", /1 call\(s\) changed, 1 added, 1 no longer happen/.test(ascii.out)],
  ["security label surfaced", ascii.out.includes("🔐 security.authentication")],
  ["security count called out", /⚠ 1 on a security-labeled path/.test(ascii.out)],
  ["removed call named", /withheldEntry[\s\S]*no longer happens/.test(ascii.out)],
  ["added call named", /contradictionsFromWithheld[\s\S]*added/.test(ascii.out)],
  ["before/after has two mermaid blocks", (ba.out.match(/```mermaid/g) || []).length === 2],
  ["before side shows the removed call", beforeBlock.includes("withheldEntry") && !beforeBlock.includes("contradictionsFromWithheld")],
  ["after side shows the added call", afterBlock.includes("contradictionsFromWithheld") && !afterBlock.includes("withheldEntry")],
  ["unchanged runs collapse", /· 2 unchanged/.test(merm.out)],
  ["mermaid escapes are applied (no raw ; or : in labels)", !/->>.*: .*[;:]/.test(merm.out.replace(/participant .* as .*/g, ""))],
];

let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "ok  " : "FAIL"} - ${name}`); if (!ok) failed++; }
if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log(`\nAll ${checks.length} checks passed.`);
