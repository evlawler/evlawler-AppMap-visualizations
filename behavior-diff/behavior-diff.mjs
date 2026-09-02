#!/usr/bin/env node
// behavior-diff — show, in plain language, how a flow's behavior changed between
// two recordings of the same test. For reviewers, including non-developers
// (product, security, compliance, owners): a one-line summary anyone can read, a
// picture of what moved, and an inventory of every part so nothing is left
// unexplained. It draws facts; it does not judge (that stays in appmap-review).
//
// Two ways to give it input (design note #1 — support both):
//   - TWO sequence exports (before + after): change status is computed from each
//     call's own subtreeDigest/digest, so nothing is guessed.
//   - ONE diff export (`*.diff.sequence.json` from `appmap compare`): change status
//     is read straight from AppMap's native `diffMode` (Insert=1 / Delete=2 /
//     Change=3) — the canonical source, no re-deriving.
//
// Formats:
//   --format ascii          indented step list for the TERMINAL (devs: code refs)
//   --format mermaid        one diff diagram for a GitHub PR
//   --format before-after   TWO diagrams — the old path and the new path
//   --format all            ascii, then before/after, then the single diff
//
// Sequence exports come from `appmap sequence-diagram <recording> --format json`.
// Exit code: 0 if nothing changed, 1 if something did — so it can gate CI.
//
// Usage:
//   node behavior-diff.mjs <before>.sequence.json <after>.sequence.json [opts]
//   node behavior-diff.mjs <one>.diff.sequence.json [opts]
//   opts: [--format ascii|mermaid|before-after|all] [--title "..."] [--cap N] [--exclude a,b]
//
// Dependency-free (only node:fs). Recorded values are sanitized tokens, so output
// is safe to paste into a public PR; reason from structure and labels, not values.
// The reviewer report this feeds (severity table -> numbered findings with
// file:line + trace evidence -> checks ledger) is defined by the appmap-review
// skill; this tool is the render step of that pipeline.
//
// Handoff note still open: source file:line is NOT in the sequence export — nodes
// carry stableProperties.id (a stable fully-qualified id) and eventIds. Resolving
// id -> path:line needs the recording's classMap. We show the id as the code ref;
// pass a classMap to upgrade it to a clickable path:line.

import { readFileSync } from "node:fs";

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
// Value-taking flags consume the next token, so their values are never mistaken
// for positional file arguments.
const VALUE_FLAGS = new Set(["format", "title", "cap", "exclude"]);
const positional = [];
const opts = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); opts[k] = VALUE_FLAGS.has(k) ? argv[++i] : true; }
  else positional.push(a);
}
if (positional.length < 1) {
  console.error("usage: behavior-diff.mjs <before>.sequence.json <after>.sequence.json  |  <one>.diff.sequence.json  [--format ascii|mermaid|before-after|all] [--title ...] [--cap N]");
  process.exit(2);
}
const format = opts.format ?? "ascii";
const title = opts.title ?? "";
const CAP = Number(opts.cap ?? 200);
const excluded = new Set((opts.exclude ?? "cn,DialogHeader,DialogFooter").split(",").filter(Boolean));

// ── node-type + field helpers (schema per @appland/sequence-diagram) ──────────
// NodeType enum: Loop=1, Conditional=2, Function=3, ServerRPC=4, ClientRPC=5, Query=6.
const NT = { LOOP: 1, COND: 2, FUNC: 3, SRPC: 4, CRPC: 5, QUERY: 6 };
const NT_NAME = { loop: 1, conditional: 2, function: 3, server_rpc: 4, serverrpc: 4, client_rpc: 5, clientrpc: 5, query: 6 };
const nt = (n) => (typeof n?.nodeType === "number" ? n.nodeType : NT_NAME[String(n?.nodeType ?? n?.type ?? "").toLowerCase()] ?? null);
const calleeOf = (n) => (typeof n?.callee === "object" ? n.callee?.id : n.callee);
const loopCount = (n) => (nt(n) === NT.LOOP ? n.count ?? null : null);
// Native diffMode enum on a diff export: Insert=1 (added), Delete=2 (removed), Change=3.
const DM = { INSERT: 1, DELETE: 2, CHANGE: 3 };

// A short factual detail a reviewer cares about, straight from the node's own fields.
const factOf = (n) => {
  const t = nt(n);
  if (t === NT.SRPC || t === NT.CRPC) return [n.route, n.status].filter((x) => x != null).join(" → ") || null;
  if (t === NT.QUERY) return n.query ? "SQL " + String(n.query).replace(/\s+/g, " ").slice(0, 46) : null;
  if (n.returnValue?.raisesException || n.stableProperties?.raises_exception) return "throws";
  return null;
};
const codeRef = (n) => n?.stableProperties?.id ?? null; // fqid, e.g. "lib/models/User.find"
const nameOf = (n) => n?.name ?? n?.route ?? "(step)"; // ServerRPC/Query carry route/query, not name

// ── load ─────────────────────────────────────────────────────────────────────
let baseline, current, mode;
if (positional.length >= 2) {
  baseline = JSON.parse(readFileSync(positional[0], "utf8"));
  current = JSON.parse(readFileSync(positional[1], "utf8"));
  mode = "two-side";
} else {
  const diff = JSON.parse(readFileSync(positional[0], "utf8"));
  baseline = current = diff; // one tree carrying inserted + deleted + changed inline
  mode = "diffmode";
}

const actorName = new Map();
for (const a of [...(baseline.actors ?? []), ...(current.actors ?? [])]) if (!actorName.has(a.id)) actorName.set(a.id, a.name ?? a.id);
const shortId = new Map();
[...actorName.keys()].forEach((id, i) => shortId.set(id, `A${i}`));
const laneName = (id) => actorName.get(id) ?? String(id ?? "?").replace(/^package:/, "");

const labelsOf = (n) => (Array.isArray(n?.labels) ? n.labels : []);
const securityLabel = (n) => labelsOf(n).find((l) => /^security(\.|$)/.test(l));
const topLabel = (n) => securityLabel(n) ?? labelsOf(n)[0] ?? null;
const PLAIN_LABEL = {
  "security.authentication": "login / identity check",
  "security.authorization": "permission check",
  "security.pii": "handles personal data",
  security: "security-sensitive",
  "io.file": "reads or writes files",
  "io.network": "makes a network call",
  database: "talks to the database",
  sql: "runs a database query",
};
const plainLabel = (l) => (l ? PLAIN_LABEL[l] ?? l : null);

// AppMap's own diff palette (packages/sequence-diagram plantUML: added #EBFEEE,
// removed #FCECEA; webview marks changed in blue) — light tints for Mermaid bands.
const COLOR = { added: "rgb(235, 254, 238)", removed: "rgb(252, 236, 234)", changed: "rgb(231, 238, 247)" };

// ── diff (two-side digest) ────────────────────────────────────────────────────
const key = (n) => `${nt(n)} ${calleeOf(n)} ${n.name}`;
const info = new Map(); // node ref -> {status, selfChanged, label, security}
function countCalls(node) { let n = 1; for (const c of node.children ?? []) n += countCalls(c); return n; }
function align(b0, c0) {
  const b = b0 ?? [], c = c0 ?? [], m = b.length, n = c.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = key(b[i]) === key(c[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = []; let i = 0, j = 0;
  while (i < m && j < n) {
    if (key(b[i]) === key(c[j])) { pairs.push(["match", b[i], c[j]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { pairs.push(["removed", b[i], null]); i++; }
    else { pairs.push(["added", null, c[j]]); j++; }
  }
  while (i < m) pairs.push(["removed", b[i++], null]);
  while (j < n) pairs.push(["added", null, c[j++]]);
  return pairs;
}
function diffChildren(baseKids, curKids) {
  const out = [];
  for (const [kind, bNode, cNode] of align(baseKids, curKids)) {
    const anchor = cNode ?? bNode;
    if (excluded.has(anchor?.name)) continue;
    const label = topLabel(anchor), security = !!securityLabel(anchor);
    if (kind === "added") { out.push({ status: "added", node: cNode, lane: calleeOf(cNode), subsumes: countCalls(cNode), label, security }); info.set(cNode, { status: "added", label, security }); }
    else if (kind === "removed") { out.push({ status: "removed", node: bNode, lane: calleeOf(bNode), subsumes: countCalls(bNode), label, security }); info.set(bNode, { status: "removed", label, security }); }
    else if (bNode.subtreeDigest && cNode.subtreeDigest && bNode.subtreeDigest === cNode.subtreeDigest) { out.push({ status: "unchanged", node: cNode, lane: calleeOf(cNode), subsumes: countCalls(cNode) }); }
    else {
      const selfChanged = bNode.digest !== cNode.digest;
      out.push({ status: "changed", node: cNode, lane: calleeOf(cNode), selfChanged, label, security, children: diffChildren(bNode.children, cNode.children) });
      info.set(cNode, { status: "changed", selfChanged, label, security });
      info.set(bNode, { status: "changed", selfChanged, label, security });
    }
  }
  return out;
}

// ── diff (native diffMode) ────────────────────────────────────────────────────
function diffFromModes(nodes) {
  const out = [];
  for (const n of nodes ?? []) {
    if (excluded.has(n.name)) continue;
    const label = topLabel(n), security = !!securityLabel(n);
    if (n.diffMode === DM.INSERT) { out.push({ status: "added", node: n, lane: calleeOf(n), subsumes: countCalls(n), label, security }); info.set(n, { status: "added", label, security }); }
    else if (n.diffMode === DM.DELETE) { out.push({ status: "removed", node: n, lane: calleeOf(n), subsumes: countCalls(n), label, security }); info.set(n, { status: "removed", label, security }); }
    else if (n.diffMode === DM.CHANGE) { out.push({ status: "changed", node: n, lane: calleeOf(n), selfChanged: true, label, security, formerName: n.formerName, children: diffFromModes(n.children) }); info.set(n, { status: "changed", selfChanged: true, label, security }); }
    else {
      const kids = diffFromModes(n.children);
      if (kids.some((k) => k.status !== "unchanged")) { out.push({ status: "changed", node: n, lane: calleeOf(n), selfChanged: false, label, security, children: kids }); info.set(n, { status: "changed", selfChanged: false, label, security }); }
      else out.push({ status: "unchanged", node: n, lane: calleeOf(n), subsumes: countCalls(n) });
    }
  }
  return out;
}

const roots = mode === "diffmode" ? diffFromModes(current.rootActions) : diffChildren(baseline.rootActions, current.rootActions);

const tally = { changed: 0, added: 0, removed: 0, security: 0 };
(function count(nodes) {
  for (const d of nodes) {
    if (d.status === "added") { tally.added += d.subsumes; if (d.security) tally.security++; }
    else if (d.status === "removed") { tally.removed += d.subsumes; if (d.security) tally.security++; }
    else if (d.status === "changed") { if (d.selfChanged) { tally.changed += 1; if (d.security) tally.security++; } count(d.children ?? []); }
  }
})(roots);

const nothingChanged = tally.changed === 0 && tally.added === 0 && tally.removed === 0;
const securityNote = tally.security > 0 ? ` ${tally.security} of these is on a security check — look there first.` : "";
const summary = nothingChanged
  ? "Nothing changed: the code ran the same way it did before."
  : `What changed: ${tally.changed} step(s) now behave differently, ${tally.added} new, ${tally.removed} no longer happen.${securityNote}`;

const callout = (base, m) => { const lab = plainLabel(m?.label); if (m?.security) return `🔐 ${lab} — ${base}`; if (lab) return `${base} (${lab})`; return base; };
const withFact = (note, node) => { const f = factOf(node); return f ? `${note} — ${f}` : note; };
const esc = (s) => String(s ?? "").replaceAll(";", ",").replaceAll(":", " -").slice(0, 60);

// ── render: ASCII (terminal, dev-facing) ──────────────────────────────────────
function renderAscii() {
  const MARK = { changed: "~", added: "+", removed: "-", unchanged: "·" };
  const out = [title ? `Behavior diff — ${title}` : "Behavior diff",
    "  key:  ~ different now   + new step   - no longer happens   · same as before   🔐 security check",
    `  ${summary}`, ""];
  let emitted = 0;
  const walk = (nodes, prefix, depth) => {
    nodes.forEach((d, idx) => {
      if (emitted >= CAP) return;
      const last = idx === nodes.length - 1;
      const branch = depth === 0 ? "" : last ? "└─ " : "├─ ";
      const lane = laneName(d.lane);
      const ref = codeRef(d.node);
      const fact = factOf(d.node);
      const tail = (d.security ? "  🔐" : "") + (fact ? `  ${fact}` : "") + (ref ? `  → ${ref}` : "");
      let note = "";
      if (d.status === "changed") note = d.selfChanged ? "  different now" : "  (something inside changed)";
      else if (d.status === "added") note = d.subsumes > 1 ? `  new (${d.subsumes} steps)` : "  new";
      else if (d.status === "removed") note = d.subsumes > 1 ? `  no longer happens (${d.subsumes} steps)` : "  no longer happens";
      else if (d.subsumes > 1) note = `  · ${d.subsumes} steps, same as before`;
      out.push(`  ${prefix}${branch}${MARK[d.status]} ${nameOf(d.node)}  [${lane}]${note}${tail}`);
      emitted++;
      if (d.status === "changed" && d.children?.length) walk(d.children, prefix + (depth === 0 ? "" : last ? "   " : "│  "), depth + 1);
    });
  };
  walk(roots, "", 0);
  if (emitted >= CAP) out.push(`  … shortened at ${CAP} rows (raise with --cap)`);
  return out.join("\n");
}

// ── render: single diff diagram (Mermaid) ─────────────────────────────────────
function renderMermaid() {
  const lines = [];
  if (title) lines.push("---", `title: ${title}`, "---");
  lines.push("sequenceDiagram");
  const used = new Set();
  (function scan(nodes) { for (const d of nodes) { if (d.lane != null) used.add(d.lane); if (d.children) scan(d.children); } })(roots);
  for (const id of used) lines.push(`  participant ${shortId.get(id)} as ${laneName(id)}`);
  const anyLane = () => shortId.get([...used][0]);
  let emitted = 0, pending = 0;
  const flush = (lane) => { if (pending > 0) { lines.push(`  note over ${shortId.get(lane) ?? anyLane()}: · ${pending} steps, same as before`); pending = 0; } };
  const band = (color, note, lane, name) => lines.push(`  rect ${color}`, `    note over ${shortId.get(lane)}: ${note}`, `  ${shortId.get(lane)}->>${shortId.get(lane)}: ${esc(name)}`, "  end");
  const walk = (nodes) => {
    for (const d of nodes) {
      if (emitted >= CAP) return;
      if (d.status === "unchanged") { pending += 1; continue; }
      flush(d.lane);
      if (d.status === "added") band(COLOR.added, withFact(callout("new", d), d.node), d.lane, nameOf(d.node));
      else if (d.status === "removed") band(COLOR.removed, withFact(callout("no longer happens", d), d.node), d.lane, nameOf(d.node));
      else if (d.status === "changed") {
        if (d.selfChanged) band(COLOR.changed, withFact(callout("different now", d), d.node), d.lane, nameOf(d.node));
        else lines.push(`  ${shortId.get(d.lane)}->>${shortId.get(d.lane)}: ${esc(nameOf(d.node))}`);
        if (d.children?.length) walk(d.children);
      }
      emitted++;
    }
  };
  walk(roots);
  flush([...used][0]);
  if (emitted >= CAP) lines.push(`  note over ${anyLane()}: … shortened at ${CAP} steps`);
  return ["```mermaid", ...lines, "```", "", `**What changed:** ${summary}`].join("\n");
}

// ── render: before / after pair (Mermaid) ─────────────────────────────────────
function renderSide(rootActions, side) {
  const lines = ["sequenceDiagram"];
  const used = new Set();
  (function scan(nodes) { for (const n of nodes ?? []) { if (excluded.has(n.name)) continue; const m = info.get(n); if (side === "before" && m?.status === "added") continue; if (side === "after" && m?.status === "removed") continue; const l = calleeOf(n); if (l != null) used.add(l); scan(n.children); } })(rootActions);
  for (const id of used) lines.push(`  participant ${shortId.get(id)} as ${laneName(id)}`);
  const anyLane = () => shortId.get([...used][0]);
  let emitted = 0, pending = 0;
  const flush = () => { if (pending > 0) { lines.push(`  note over ${anyLane()}: · ${pending} steps, same as before`); pending = 0; } };
  const band = (color, note, lane, name) => lines.push(`  rect ${color}`, `    note over ${shortId.get(lane)}: ${note}`, `  ${shortId.get(lane)}->>${shortId.get(lane)}: ${esc(name)}`, "  end");
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      if (emitted >= CAP) return;
      if (excluded.has(n.name)) continue;
      const m = info.get(n);
      // A step that didn't exist on this side is skipped entirely (not collapsed).
      if (side === "before" && m?.status === "added") continue;
      if (side === "after" && m?.status === "removed") continue;
      const lane = calleeOf(n);
      const relevant = side === "before" ? m?.status === "removed" || (m?.status === "changed" && m.selfChanged) : m?.status === "added" || (m?.status === "changed" && m.selfChanged);
      if (!relevant) { pending += 1; walk(n.children); continue; }
      flush();
      const lc = loopCount(n); if (lc) lines.push(`  note over ${shortId.get(lane)}: repeats ×${lc}`);
      if (m.status === "removed") band(COLOR.removed, withFact(callout("no longer happens", m), n), lane, nameOf(n));
      else if (m.status === "added") band(COLOR.added, withFact(callout("new", m), n), lane, nameOf(n));
      else band(COLOR.changed, withFact(callout("different now", m), n), lane, nameOf(n));
      emitted++;
      walk(n.children);
    }
  };
  walk(rootActions);
  flush();
  if (emitted >= CAP) lines.push(`  note over ${anyLane()}: … shortened at ${CAP} steps`);
  return [`### ${side === "before" ? "Before" : "After"}`, "", "```mermaid", ...lines, "```"].join("\n");
}
function renderBeforeAfter() {
  return [title ? `## What changed — ${title}` : "## What changed", "", `**In one line:** ${summary}`, "",
    renderSide(baseline.rootActions, "before"), "", renderSide(current.rootActions, "after")].join("\n");
}

// ── parts inventory — so nothing shown goes unexplained ───────────────────────
function collectMoved(nodes, acc = []) { for (const d of nodes) { if (d.status === "added" || d.status === "removed" || (d.status === "changed" && d.selfChanged)) acc.push(d); if (d.children) collectMoved(d.children, acc); } return acc; }
function renderParts() {
  const moved = collectMoved(roots);
  if (!moved.length) return "";
  const lanes = [...new Set(moved.map((d) => d.lane))];
  const out = ["## Parts shown here", "Write one plain sentence for each — what it is, in a reviewer's terms (see SKILL.md):", "", "**Where it happens (the code areas):**"];
  for (const id of lanes) out.push(`- \`${laneName(id)}\` — `);
  out.push("", "**Steps that moved:**");
  for (const d of moved) {
    const what = d.status === "added" ? "new" : d.status === "removed" ? "no longer happens" : "different now";
    const lab = plainLabel(d.label), fact = factOf(d.node), ref = codeRef(d.node);
    out.push(`- \`${nameOf(d.node)}\` in \`${laneName(d.lane)}\` — ${what}${lab ? ` — ${lab}` : ""}${fact ? ` — ${fact}` : ""}${ref ? ` — \`${ref}\`` : ""} — `);
  }
  return out.join("\n");
}

// ── go ───────────────────────────────────────────────────────────────────────
const parts = nothingChanged ? "" : "\n\n" + renderParts();
let output;
if (format === "mermaid") output = renderMermaid();
else if (format === "before-after") output = renderBeforeAfter() + parts;
else if (format === "all") output = [renderAscii(), "", renderBeforeAfter(), "", renderMermaid()].join("\n") + parts;
else output = renderAscii() + parts;
process.stdout.write(output + "\n");
process.exit(nothingChanged ? 0 : 1);
