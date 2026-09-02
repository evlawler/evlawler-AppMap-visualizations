// Dependency-free test for explain-trace. Runs it on the bundled gold-trace
// fixture and asserts the "What it touches" panel, the flattened walkthrough, and
// the picture. Run: node test/run.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "explain-trace.mjs");
const trace = join(here, "fixtures", "share-profile.sequence.json");

const brief = execFileSync("node", [bin, trace, "--title", "Share your profile by email"], { encoding: "utf8" });
const merm = execFileSync("node", [bin, trace, "--format", "mermaid"], { encoding: "utf8" });

const checks = [
  ["names it a gold trace in plain words", /newly recorded gold trace/.test(brief)],
  ["flags login/identity", /Security & access[\s\S]*checks who you are/.test(brief)],
  ["flags personal data", /Personal data[\s\S]*personal data/.test(brief)],
  ["flags the database (from a query step, no label needed)", /Database[\s\S]*SELECT name, email FROM person/.test(brief)],
  ["flags an outside service call", /External services[\s\S]*sendShareEmail/.test(brief)],
  ["walkthrough flattens to notable steps", /requireLogin/.test(brief) && /loadProfile/.test(brief) && /sendShareEmail/.test(brief)],
  ["walkthrough tags what a step touches", /requireLogin[\s\S]*\[Security & access\]/.test(brief)],
  ["lists the code areas to explain", /## The parts \(code areas\)/.test(brief) && /`mailer` —/.test(brief)],
  ["picture is a mermaid sequence diagram", /```mermaid[\s\S]*sequenceDiagram/.test(merm)],
  ["picture notes what each step touches", /note over .*: Personal data/.test(merm)],
];

let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "ok  " : "FAIL"} - ${name}`); if (!ok) failed++; }
if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log(`\nAll ${checks.length} checks passed.`);
