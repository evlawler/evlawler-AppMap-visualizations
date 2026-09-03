// Dependency-free test for behavior-diff. Exercises BOTH inputs (two sequence
// exports, and one native diffMode export), plain-language wording, label
// translation, code refs, HTTP/SQL facts, AppMap's palette, and the CI exit codes.
// Run: node test/run.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "behavior-diff.mjs");
const f = (n) => join(here, "fixtures", n);
const base = f("baseline.sequence.json");
const cur = f("current.sequence.json");
const diff = f("whoami.diff.sequence.json");

function run(args) {
  try { return { code: 0, out: execFileSync("node", [bin, ...args], { encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "").toString() }; }
}

const ascii = run([base, cur, "--format", "ascii"]);
const ba = run([base, cur, "--format", "before-after"]);
const merm = run([base, cur, "--format", "mermaid"]);
const same = run([base, base, "--format", "ascii"]);
const dm = run([diff, "--format", "ascii"]);          // native diffMode, one input
const dmMerm = run([diff, "--format", "mermaid"]);
const beforeBlock = ba.out.split("### After")[0];
const afterBlock = (ba.out.split("### After")[1] ?? "").split("## Parts shown here")[0];

const checks = [
  ["two-side: change → exit 1", ascii.code === 1],
  ["identical inputs → exit 0", same.code === 0],
  ["plain-language tally", /2 step\(s\) now behave differently, 0 new, 1 no longer happen/.test(ascii.out)],
  ["security called out in plain words", /1 of these is on a security check — look there first/.test(ascii.out)],
  ["dev view shows the real code ref (fqid)", ascii.out.includes("web/JWTUtilities.verifyAndGetSubject")],
  ["dev view marks security (🔐) and the exception (throws)", ascii.out.includes("🔐") && /verifyAndGetSubject[^\n]*throws/.test(ascii.out)],
  ["HTTP status flip surfaced from the ServerRPC node", /GET \/api\/user\/whoami → 403/.test(ascii.out)],
  ["dropped SQL surfaced from the Query node", /SELECT roles FROM person[\s\S]*no longer happens/.test(ascii.out)],
  ["reviewer view translates the label to plain English", ba.out.includes("login / identity check")],
  ["before/after has two mermaid blocks", (ba.out.match(/```mermaid/g) || []).length === 2],
  ["before side shows the dropped query, after side does not", beforeBlock.includes("SELECT roles FROM person") && !afterBlock.includes("SELECT roles FROM person")],
  ["uses AppMap's diff palette (removed #FCECEA, changed blue)", merm.out.includes("rgb(252, 236, 234)") && merm.out.includes("rgb(231, 238, 247)")],
  ["parts inventory lists what to explain", /## Parts shown here/.test(ascii.out) && /Where it happens/.test(ascii.out)],
  ["native diffMode: one diff export → exit 1", dm.code === 1],
  ["native diffMode agrees: status flip + dropped SQL", /GET \/api\/user\/whoami → 403/.test(dm.out) && /SELECT roles FROM person[\s\S]*no longer happens/.test(dm.out)],
  ["native diffMode: security change flagged", dm.out.includes("🔐") && dm.out.includes("verifyAndGetSubject")],
  ["mermaid labels escape ; and :", !/->>.*: .*[;:]/.test(dmMerm.out.replace(/participant .* as .*/g, "").replace(/^---[\s\S]*?---/m, ""))],
];

let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "ok  " : "FAIL"} - ${name}`); if (!ok) failed++; }
if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log(`\nAll ${checks.length} checks passed.`);
