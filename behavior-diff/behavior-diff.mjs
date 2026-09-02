#!/usr/bin/env node
// behavior-diff — render an AppMap behavioral diff a human can read in ten
// seconds. Consolidated best-of two prototypes:
//
//   - the digest-based diff ENGINE (LCS alignment + subtreeDigest/digest, honest
//     unchanged-collapse) and the ASCII + single Mermaid diff view, from the W2SE
//     build (session 01DWEa6t914NxNtLCaQhnS64);
//   - the literal BEFORE/AFTER pair view and CI exit-code gating, from the
//     AppMap-visualizations build (session 017qStU1BiJDPwFbmGPPPtLT);
//   - label-awareness (security-labeled changes get the strongest treatment) and
//     collapse-before-cap, from the W2SE design notes.
//
// Formats:
//   --format ascii          indented call graph for the TERMINAL / CLI
//   --format mermaid        one Mermaid DIFF diagram for github.com (changed/added
//                           in an amber band, removed in a red band)
//   --format before-after   TWO Mermaid diagrams — the baseline path and the
//                           current path side by side, each highlighting where it
//                           differs (the "what did the code do before vs now" view)
//   --format all            ascii, then before-after, then the single diff view
//
// Input: two AppMap **sequence exports** — the JSON from
//   `appmap sequence-diagram <recording> --format json` — a baseline and a current.
// It does NOT guess: change status comes from the recordings' own
// `subtreeDigest`/`digest`; a subtree whose digest matches on both sides is
// unchanged, full stop. (See handoff note 1 for the native-`diffMode` alternative.)
//
// Exit code: 0 when nothing changed, 1 when a behavioral change is detected — so
// it can gate CI (`node behavior-diff.mjs base cur --format ascii || echo changed`).
//
// Usage:
//   node behavior-diff.mjs <baseline>.sequence.json <current>.sequence.json \
//        [--format ascii|mermaid|before-after|all] [--title "..."] [--cap N] [--exclude a,b,c]
//
// Dependency-free (only node:fs). Sequence-export values are sanitized tokens when
// recorded through AppMap's `sanitize`, so the output is safe to print and to paste
// into a pull request — reason from structure and labels, never from a value.
//
// --- Handoff notes for the AppMap team ----------------------------------------
//  1. `appmap compare` already emits per-action `diffMode` in its
//     `.diff.sequence.json` (a bare number 1/2/3 in the recordings we had). Decoding
//     that native enum directly would be cleaner than this file's two-side digest
//     alignment — but the number→meaning mapping wasn't documented where this was
//     written, and a wrong guess flips added/removed, so we used digests. The team
//     owns that enum (@appland/sequence-diagram): support BOTH — decode diffMode
//     when handed one .diff.sequence.json, compute digests when handed two sides.
//  2. The amber/red bands approximate the "Live Trace Placements" / Waltz treatment
//     on appmap.io — swap in the real palette + callout wording.
//  3. Web semantics (HTTP status flips like 200→403, dropped SQL reads, thrown
//     exceptions) make "breaking" legible. The companion raw-.appmap.json build
//     surfaces those from the event tree; folding them in here depends on whether
//     the sequence export carries them as first-class action fields — confirm the
//     schema before adding, rather than guess it.
// ------------------------------------------------------------------------------

import { readFileSync } from "node:fs";

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
if (positional.length < 2) {
  console.error(
    "usage: behavior-diff.mjs <baseline>.sequence.json <current>.sequence.json [--format ascii|mermaid|before-after|all] [--title ...] [--cap N]",
  );
  process.exit(2);
}
const [baselineFile, currentFile] = positional;
const format = flag("format", "ascii");
const title = flag("title", "");
const CAP = Number(flag("cap", 200));
// Pure-presentation calls that add noise, not story (override with --exclude a,b).
const excluded = new Set((flag("exclude", "cn,DialogHeader,DialogFooter") || "").split(",").filter(Boolean));

// ── load ─────────────────────────────────────────────────────────────────────
const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
const current = JSON.parse(readFileSync(currentFile, "utf8"));

// Actor lanes are keyed by id; keep a display name and a stable short id for both.
const actorName = new Map();
for (const a of [...(baseline.actors ?? []), ...(current.actors ?? [])]) {
  if (!actorName.has(a.id)) actorName.set(a.id, a.name ?? a.id);
}
const shortId = new Map();
[...actorName.keys()].forEach((id, i) => shortId.set(id, `A${i}`));
const calleeOf = (n) => (typeof n?.callee === "object" ? n.callee?.id : n.callee);
const laneName = (id) => actorName.get(id) ?? String(id ?? "?").replace(/^package:/, "");

// Labels carry the meaning (design note #4): a changed security.authentication
// call matters far more than a changed formatting helper. Surface them, and give
// security-labeled changes the strongest callout.
const labelsOf = (n) => (Array.isArray(n?.labels) ? n.labels : []);
const securityLabel = (n) => labelsOf(n).find((l) => /^security(\.|$)/.test(l));
const topLabel = (n) => securityLabel(n) ?? labelsOf(n)[0] ?? null;
const loopCount = (n) => (n?.nodeType === "loop" || n?.type === "loop" ? n?.count ?? n?.iterations ?? null : null);

// ── diff ─────────────────────────────────────────────────────────────────────
const key = (n) => `${n.nodeType} ${calleeOf(n)} ${n.name}`;
const meta = new Map(); // node ref -> {status, selfChanged, label, security}
const tag = (node, info) => meta.set(node, info);

function countCalls(node) {
  let n = 1;
  for (const c of node.children ?? []) n += countCalls(c);
  return n;
}

// LCS alignment on (nodeType, callee, name), preserving order — so an inserted or
// deleted call is detected, not mistaken for a change.
function align(baseKids, curKids) {
  const b = baseKids ?? [];
  const c = curKids ?? [];
  const m = b.length;
  const n = c.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = key(b[i]) === key(c[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
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
    const label = topLabel(anchor);
    const security = !!securityLabel(anchor);
    if (kind === "added") {
      out.push({ status: "added", node: cNode, lane: calleeOf(cNode), subsumes: countCalls(cNode), label, security });
      tag(cNode, { status: "added", label, security });
    } else if (kind === "removed") {
      out.push({ status: "removed", node: bNode, lane: calleeOf(bNode), subsumes: countCalls(bNode), label, security });
      tag(bNode, { status: "removed", label, security });
    } else if (bNode.subtreeDigest && cNode.subtreeDigest && bNode.subtreeDigest === cNode.subtreeDigest) {
      out.push({ status: "unchanged", node: cNode, lane: calleeOf(cNode), subsumes: countCalls(cNode) });
    } else {
      const selfChanged = bNode.digest !== cNode.digest;
      out.push({ status: "changed", node: cNode, lane: calleeOf(cNode), selfChanged, label, security, children: diffChildren(bNode.children, cNode.children) });
      tag(cNode, { status: "changed", selfChanged, label, security });
      tag(bNode, { status: "changed", selfChanged, label, security });
    }
  }
  return out;
}

const roots = diffChildren(baseline.rootActions, current.rootActions);

// Tally, so the plain-English summary is honest.
const tally = { changed: 0, added: 0, removed: 0, security: 0 };
(function count(nodes) {
  for (const d of nodes) {
    if (d.status === "added") { tally.added += d.subsumes; if (d.security) tally.security++; }
    else if (d.status === "removed") { tally.removed += d.subsumes; if (d.security) tally.security++; }
    else if (d.status === "changed") { if (d.selfChanged) { tally.changed += 1; if (d.security) tally.security++; } count(d.children ?? []); }
  }
})(roots);

const nothingChanged = tally.changed === 0 && tally.added === 0 && tally.removed === 0;
const securityNote = tally.security > 0 ? ` ⚠ ${tally.security} on a security-labeled path.` : "";
const summary = nothingChanged
  ? "No runtime behavior changed — every call path is identical to the baseline."
  : `Runtime behavior changed: ${tally.changed} call(s) changed, ${tally.added} added, ${tally.removed} no longer happen.${securityNote}`;

// A callout string for a highlighted call, folding in its label (#4).
const callout = (base, m) => {
  if (m?.security) return `🔐 ${m.label} — ${base}`;
  if (m?.label) return `${base} (${m.label})`;
  return base;
};
const esc = (s) => String(s ?? "").replaceAll(";", ",").replaceAll(":", " -").slice(0, 60);

// ── render: ASCII (terminal) ──────────────────────────────────────────────────
function renderAscii() {
  const MARK = { changed: "~", added: "+", removed: "-", unchanged: "·" };
  const out = [];
  out.push(title ? `Behavior diff — ${title}` : "Behavior diff");
  out.push(`  legend:  ~ changed   + added   - removed   · unchanged   🔐 security-labeled`);
  out.push(`  ${summary}`);
  out.push("");
  let emitted = 0;
  const walk = (nodes, prefix, depth) => {
    nodes.forEach((d, idx) => {
      if (emitted >= CAP) return;
      const last = idx === nodes.length - 1;
      const branch = depth === 0 ? "" : last ? "└─ " : "├─ ";
      const name = d.node?.name ?? "?";
      const lane = laneName(d.lane);
      const lab = d.label ? (d.security ? `  🔐 ${d.label}` : `  «${d.label}»`) : "";
      let note = "";
      if (d.status === "changed") note = d.selfChanged ? "  changed vs baseline" : "  (contains changes)";
      else if (d.status === "added") note = d.subsumes > 1 ? `  added (+${d.subsumes} calls)` : "  added";
      else if (d.status === "removed") note = d.subsumes > 1 ? `  no longer happens (-${d.subsumes} calls)` : "  no longer happens";
      else if (d.subsumes > 1) note = `  · ${d.subsumes} unchanged calls`;
      out.push(`  ${prefix}${branch}${MARK[d.status]} ${name}  [${lane}]${note}${lab}`);
      emitted++;
      if (d.status === "changed" && d.children?.length) {
        const childPrefix = prefix + (depth === 0 ? "" : last ? "   " : "│  ");
        walk(d.children, childPrefix, depth + 1);
      }
    });
  };
  walk(roots, "", 0);
  if (emitted >= CAP) out.push(`  … truncated at ${CAP} rows (raise with --cap)`);
  return out.join("\n");
}

// ── render: Mermaid single DIFF view (GitHub) ─────────────────────────────────
function renderMermaid() {
  const lines = [];
  if (title) lines.push("---", `title: ${title}`, "---");
  lines.push("sequenceDiagram");
  const used = new Set();
  (function scan(nodes) { for (const d of nodes) { if (d.lane != null) used.add(d.lane); if (d.children) scan(d.children); } })(roots);
  for (const id of used) lines.push(`  participant ${shortId.get(id)} as ${laneName(id)}`);

  let emitted = 0;
  let pendingUnchanged = 0;
  const anyLane = () => shortId.get([...used][0]);
  const flushUnchanged = (lane) => {
    if (pendingUnchanged > 0) { lines.push(`  note over ${shortId.get(lane) ?? anyLane()}: · ${pendingUnchanged} unchanged`); pendingUnchanged = 0; }
  };
  const band = (color, note, lane, name) => {
    lines.push(`  rect ${color}`);
    lines.push(`    note over ${shortId.get(lane)}: ${note}`);
    lines.push(`  ${shortId.get(lane)}->>${shortId.get(lane)}: ${esc(name)}`);
    lines.push("  end");
  };
  const walk = (nodes) => {
    for (const d of nodes) {
      if (emitted >= CAP) return;
      if (d.status === "unchanged") { pendingUnchanged += 1; continue; }
      flushUnchanged(d.lane);
      if (d.status === "added") band("rgb(212, 237, 218)", callout("+ added", d), d.lane, d.node.name);
      else if (d.status === "removed") band("rgb(248, 215, 218)", callout("✗ no longer happens", d), d.lane, d.node.name);
      else if (d.status === "changed") {
        if (d.selfChanged) band("rgb(255, 243, 205)", callout("~ changed vs baseline", d), d.lane, d.node.name);
        else lines.push(`  ${shortId.get(d.lane)}->>${shortId.get(d.lane)}: ${esc(d.node.name)}`);
        if (d.children?.length) walk(d.children);
      }
      emitted++;
    }
  };
  walk(roots);
  flushUnchanged([...used][0]);
  if (emitted >= CAP) lines.push(`  note over ${anyLane()}: … truncated at ${CAP} events`);
  return ["```mermaid", ...lines, "```", "", `**What changed:** ${summary}`].join("\n");
}

// ── render: Mermaid BEFORE / AFTER pair (GitHub) ──────────────────────────────
// Walks each side's real call tree so you SEE the whole path, collapsing runs of
// unchanged calls to a count (#5) so highlighted calls survive the cap. The after
// path bands changed/added amber/green; the before path bands removed red.
function renderSide(rootActions, side) {
  const lines = ["sequenceDiagram"];
  const used = new Set();
  (function scan(nodes) {
    for (const n of nodes ?? []) { if (excluded.has(n.name)) continue; const l = calleeOf(n); if (l != null) used.add(l); scan(n.children); }
  })(rootActions);
  for (const id of used) lines.push(`  participant ${shortId.get(id)} as ${laneName(id)}`);
  const anyLane = () => shortId.get([...used][0]);

  let emitted = 0;
  let pendingUnchanged = 0;
  const flush = () => { if (pendingUnchanged > 0) { lines.push(`  note over ${anyLane()}: · ${pendingUnchanged} unchanged`); pendingUnchanged = 0; } };
  const band = (color, note, lane, name) => {
    lines.push(`  rect ${color}`, `    note over ${shortId.get(lane)}: ${note}`, `  ${shortId.get(lane)}->>${shortId.get(lane)}: ${esc(name)}`, "  end");
  };
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      if (emitted >= CAP) return;
      if (excluded.has(n.name)) continue;
      const lane = calleeOf(n);
      const m = meta.get(n);
      const lc = loopCount(n);
      const relevant = side === "before" ? m?.status === "removed" || (m?.status === "changed" && m.selfChanged)
                                          : m?.status === "added" || (m?.status === "changed" && m.selfChanged);
      if (!relevant) { pendingUnchanged += 1; walk(n.children); continue; }
      flush();
      if (lc) lines.push(`  note over ${shortId.get(lane)}: loop ×${lc}`);
      if (m.status === "removed") band("rgb(248, 215, 218)", callout("✗ no longer happens", m), lane, n.name);
      else if (m.status === "added") band("rgb(212, 237, 218)", callout("+ new here", m), lane, n.name);
      else band("rgb(255, 243, 205)", callout("~ changed", m), lane, n.name);
      emitted++;
      walk(n.children);
    }
  };
  walk(rootActions);
  flush();
  if (emitted >= CAP) lines.push(`  note over ${anyLane()}: … truncated at ${CAP} events`);
  return [`### ${side === "before" ? "Before (baseline)" : "After (current)"}`, "", "```mermaid", ...lines, "```"].join("\n");
}

function renderBeforeAfter() {
  return [
    title ? `## Behavior diff — ${title}` : "## Behavior diff",
    "",
    `**What changed:** ${summary}`,
    "",
    renderSide(baseline.rootActions, "before"),
    "",
    renderSide(current.rootActions, "after"),
    "",
  ].join("\n");
}

// ── go ───────────────────────────────────────────────────────────────────────
let output;
if (format === "mermaid") output = renderMermaid();
else if (format === "before-after") output = renderBeforeAfter();
else if (format === "all") output = [renderAscii(), "", renderBeforeAfter(), "", renderMermaid()].join("\n");
else output = renderAscii();
process.stdout.write(output + "\n");
// 0 = identical, 1 = behavioral change detected (CI gate).
process.exit(nothingChanged ? 0 : 1);
