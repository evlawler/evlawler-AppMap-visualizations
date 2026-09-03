#!/usr/bin/env node
// explain-trace — explain ONE AppMap gold trace (a newly blessed "this is how the
// feature works" recording) in plain language, for people who are not developers
// but need to understand it: product, security, compliance, owners.
//
// It answers three questions a non-developer actually asks:
//   1. What does this feature do, step by step, in plain words?
//   2. What does it TOUCH that I should care about — does it check your login,
//      read personal data, use the database, or call an outside service?
//   3. What are the parts (the code areas), each in one plain sentence?
//
// It reports what the recording shows; it does not guess. Technical labels are
// translated into plain phrases; anything it can't name is left for a person.
//
// Formats:
//   --format brief    (default) plain-English narrative + "What it touches" panel
//   --format mermaid  a simple sequence picture of the flow for a GitHub PR
//   --format all      both
//
// Input: one AppMap sequence export (`appmap sequence-diagram <rec> --format json`).
//
// Usage:
//   node explain-trace.mjs <trace>.sequence.json [--format brief|mermaid|all] \
//        [--title "what this feature is"] [--cap N] [--exclude a,b]
//
// Dependency-free (only node:fs). Recorded values are sanitized tokens, so output
// is safe to paste into a public PR.

import { readFileSync } from "node:fs";

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set(["format", "title", "cap", "exclude"]);
const positional = [];
const opts = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); opts[k] = VALUE_FLAGS.has(k) ? argv[++i] : true; }
  else positional.push(a);
}
if (positional.length < 1) {
  console.error("usage: explain-trace.mjs <trace>.sequence.json [--format brief|mermaid|all] [--title ...] [--cap N]");
  process.exit(2);
}
const trace = JSON.parse(readFileSync(positional[0], "utf8"));
const format = opts.format ?? "brief";
const title = opts.title ?? "";
const CAP = Number(opts.cap ?? 60);
const excluded = new Set((opts.exclude ?? "cn,DialogHeader,DialogFooter").split(",").filter(Boolean));

// ── helpers (schema per @appland/sequence-diagram; kept inline to stand alone) ─
// NodeType enum: Loop=1, Conditional=2, Function=3, ServerRPC=4, ClientRPC=5, Query=6.
const NT = { LOOP: 1, COND: 2, FUNC: 3, SRPC: 4, CRPC: 5, QUERY: 6 };
const NT_NAME = { loop: 1, conditional: 2, function: 3, server_rpc: 4, serverrpc: 4, client_rpc: 5, clientrpc: 5, query: 6 };
const nt = (n) => (typeof n?.nodeType === "number" ? n.nodeType : NT_NAME[String(n?.nodeType ?? n?.type ?? "").toLowerCase()] ?? null);
const actorName = new Map();
for (const a of trace.actors ?? []) if (!actorName.has(a.id)) actorName.set(a.id, a.name ?? a.id);
const shortId = new Map();
[...actorName.keys()].forEach((id, i) => shortId.set(id, `A${i}`));
const calleeOf = (n) => (typeof n?.callee === "object" ? n.callee?.id : n.callee);
const laneName = (id) => actorName.get(id) ?? String(id ?? "?").replace(/^package:/, "");
const labelsOf = (n) => (Array.isArray(n?.labels) ? n.labels : []);
const esc = (s) => String(s ?? "").replaceAll(";", ",").replaceAll(":", " -").slice(0, 60);
// ServerRPC/Query carry route/query, not name — fall back so a step always has one.
const nameOf = (n) => n?.name ?? n?.route ?? (n?.query ? String(n.query).replace(/\s+/g, " ").slice(0, 46) : null) ?? "(step)";
const factOf = (n) => {
  const t = nt(n);
  if (t === NT.SRPC || t === NT.CRPC) return [n.route, n.status].filter((x) => x != null).join(" → ") || null;
  if (t === NT.QUERY) return n.query ? "database query" : null;
  return null;
};

// What a non-developer should be told a step touches: a plain category + meaning.
const TOUCHES = [
  { key: "Security & access", why: "checks who you are or what you're allowed to do",
    test: (n) => labelsOf(n).some((l) => /^security\.(authentication|authorization)$/.test(l)) },
  { key: "Personal data", why: "reads or handles someone's personal data",
    test: (n) => labelsOf(n).some((l) => l === "security.pii" || /\bpii\b/.test(l)) },
  { key: "Database", why: "reads or writes the database",
    test: (n) => nt(n) === NT.QUERY || labelsOf(n).some((l) => l === "sql" || l === "database") },
  { key: "External services", why: "calls a service outside this app",
    test: (n) => nt(n) === NT.SRPC || nt(n) === NT.CRPC || labelsOf(n).some((l) => l === "io.network" || l === "http.client") },
  { key: "Files", why: "reads or writes files",
    test: (n) => labelsOf(n).some((l) => l === "io.file") },
];
const touchOf = (n) => TOUCHES.find((r) => r.test(n));

// ── scan the trace ─────────────────────────────────────────────────────────────
const touches = new Map();
const lanes = new Set();
(function scan(nodes) {
  for (const n of nodes ?? []) {
    if (excluded.has(n.name)) continue;
    const l = calleeOf(n);
    if (l != null) lanes.add(l);
    const hit = touchOf(n);
    if (hit) {
      const t = touches.get(hit.key) ?? { why: hit.why, count: 0, examples: new Set() };
      t.count++;
      if (t.examples.size < 3) t.examples.add(nameOf(n));
      touches.set(hit.key, t);
    }
    scan(n.children);
  }
})(trace.rootActions);

// ── render: brief (plain English, non-developer) ──────────────────────────────
function renderBrief() {
  const out = [`# ${title || "What this feature does"}`, ""];
  out.push("_A newly recorded gold trace — this is what the feature does when it works. Recorded from a real run, not written by hand._", "");
  out.push("**In one line:** _(write one plain sentence: what a person gets from this feature — see SKILL.md)_", "");
  out.push("## What it touches");
  if (touches.size === 0) {
    out.push("Nothing sensitive was detected on this path — no login checks, personal data, database, files, or outside calls were labeled. (If you expected some, check that labels were applied when recording.)");
  } else {
    for (const rule of TOUCHES) {
      const t = touches.get(rule.key);
      if (!t) continue;
      const eg = [...t.examples].join(", ");
      out.push(`- **${rule.key}** — ${t.why}. Seen ${t.count} time${t.count === 1 ? "" : "s"}${eg ? ` (e.g. ${eg})` : ""}.`);
    }
  }
  out.push("", "## Step by step", "The main steps, in the order they run. A tag shows what a step touches:", "");
  const notable = [];
  (function collect(nodes, topLevel) {
    for (const n of nodes ?? []) {
      if (excluded.has(n.name)) continue;
      const hit = touchOf(n);
      if (topLevel || hit) notable.push({ n, touch: hit?.key });
      collect(n.children, false);
    }
  })(trace.rootActions, true);
  let i = 0;
  for (const s of notable) {
    if (i >= CAP) { out.push(`… (${notable.length - i} more steps not shown; raise with --cap)`); break; }
    i++;
    const tag = s.touch ? `  _[${s.touch}]_` : "";
    const fact = factOf(s.n);
    out.push(`${i}. **${nameOf(s.n)}** — in \`${laneName(calleeOf(s.n))}\`.${tag}${fact ? ` (${fact})` : ""} _(one plain sentence — see SKILL.md)_`);
  }
  out.push("", "## The parts (code areas)", "Write one plain sentence for each — what it is, in a reviewer's terms:");
  for (const id of lanes) out.push(`- \`${laneName(id)}\` — `);
  return out.join("\n");
}

// ── render: mermaid (a simple picture of the flow) ────────────────────────────
function renderMermaid() {
  const lines = [];
  if (title) lines.push("---", `title: ${title}`, "---");
  lines.push("sequenceDiagram");
  for (const id of lanes) lines.push(`  participant ${shortId.get(id)} as ${laneName(id)}`);
  let emitted = 0;
  const walk = (nodes) => {
    for (const nd of nodes ?? []) {
      if (emitted >= CAP) return;
      if (excluded.has(nd.name)) continue;
      const lane = calleeOf(nd);
      lines.push(`  ${shortId.get(lane)}->>${shortId.get(lane)}: ${esc(nameOf(nd))}`);
      const hit = touchOf(nd);
      if (hit) lines.push(`  note over ${shortId.get(lane)}: ${hit.key}`);
      emitted++;
      walk(nd.children);
    }
  };
  walk(trace.rootActions);
  if (emitted >= CAP) lines.push(`  note over ${shortId.get([...lanes][0])}: … shortened at ${CAP} steps`);
  return ["```mermaid", ...lines, "```"].join("\n");
}

// ── go ───────────────────────────────────────────────────────────────────────
let output;
if (format === "mermaid") output = renderMermaid();
else if (format === "all") output = renderBrief() + "\n\n## Picture\n\n" + renderMermaid();
else output = renderBrief();
process.stdout.write(output + "\n");
