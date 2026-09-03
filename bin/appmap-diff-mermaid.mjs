#!/usr/bin/env node
// appmap-diff-mermaid — turn a behavioral diff (base vs head .appmap.json) into a
// before/after Mermaid picture of the code area a change breaks.
//
// Usage:
//   node bin/appmap-diff-mermaid.mjs <base.appmap.json> <head.appmap.json> [options]
//
// Options:
//   --title "<text>"   Heading for the emitted Markdown (default: derived from the request)
//   --name  "<text>"   Short trace name shown in each diagram title (default: file basename)
//   --out   <file>     Write the Markdown to a file instead of stdout
//
// Output: a Markdown document with two ```mermaid sequenceDiagram blocks (BEFORE, AFTER)
// and a "What changed" section. The AFTER diagram wraps the divergence in a red rect and
// annotates the breaking step (status flip, dropped call/query, thrown exception).
//
// Design: reads the .appmap.json event tree directly — no AppMap CLI, no puppeteer, no
// network. Portable across any project that records AppMaps.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

// ---- args -----------------------------------------------------------------
function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') opts.title = argv[++i];
    else if (a === '--name') opts.name = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a.startsWith('--')) { console.error(`Unknown option: ${a}`); process.exit(2); }
    else positional.push(a);
  }
  if (positional.length !== 2) {
    console.error('Usage: appmap-diff-mermaid <base.appmap.json> <head.appmap.json> [--title T] [--name N] [--out FILE]');
    process.exit(2);
  }
  return { base: positional[0], head: positional[1], opts };
}

// ---- appmap parsing -------------------------------------------------------
const short = (cls) => (cls ? String(cls).split(/[.$]/).filter(Boolean).pop() : null);

// Mermaid participant ids must be alphanumeric-ish; keep a stable alias table.
function laneRegistry() {
  const order = [];
  const label = new Map();
  const idFor = (name) => {
    const id = name.replace(/[^A-Za-z0-9]/g, '_');
    if (!label.has(id)) { label.set(id, name); order.push(id); }
    return id;
  };
  return { idFor, order, label };
}

function sqlSummary(sql) {
  if (!sql) return 'query';
  const s = sql.replace(/\s+/g, ' ').trim();
  const m = /^(SELECT|INSERT|UPDATE|DELETE|MERGE|WITH)\b/i.exec(s);
  const verb = m ? m[1].toUpperCase() : 'SQL';
  const tbl = /\bFROM\s+([A-Za-z_][\w.]*)/i.exec(s) || /\bINTO\s+([A-Za-z_][\w.]*)/i.exec(s) || /\bUPDATE\s+([A-Za-z_][\w.]*)/i.exec(s);
  return tbl ? `${verb} ${tbl[1]}` : verb;
}

// Walk the events array into an ordered list of "steps". Each step is a message from a
// caller lane to a callee lane, plus terminal facts (status, exception) attached on return.
// Restrict to the HTTP server request transaction: the first call carrying an
// http_server_request, through its matching return (balanced by stack depth). This
// drops test-runner frames and anything outside the request. Falls back to all events
// for non-web AppMaps (no http_server_request anywhere).
function requestScope(events) {
  let start = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i].event === 'call' && events[i].http_server_request) { start = i; break; }
  }
  if (start < 0) return events;
  let depth = 0;
  for (let i = start; i < events.length; i++) {
    if (events[i].event === 'call') depth++;
    else if (events[i].event === 'return') { depth--; if (depth === 0) return events.slice(start, i + 1); }
  }
  return events.slice(start);
}

function analyze(appmap) {
  const events = requestScope(appmap.events || []);
  const lanes = laneRegistry();
  const CLIENT = lanes.idFor('Client');
  const steps = [];
  const stack = []; // { laneId, callId, isRoot }
  const byCallId = new Map();
  let finalStatus = null;
  let rootPath = null, rootMethod = null;

  for (const e of events) {
    if (e.event === 'call') {
      const req = e.http_server_request;
      let laneId, label, kind;
      if (req) {
        laneId = lanes.idFor('App');
        rootMethod = req.request_method || 'REQ';
        rootPath = req.normalized_path_info || req.path_info || '';
        label = `${rootMethod} ${rootPath}`;
        kind = 'http';
      } else if (e.sql_query) {
        laneId = lanes.idFor('Database');
        label = sqlSummary(e.sql_query.sql);
        kind = 'sql';
      } else {
        laneId = lanes.idFor(short(e.defined_class) || 'App');
        label = e.method_id || '(call)';
        kind = 'call';
      }
      const from = stack.length ? stack[stack.length - 1].laneId : CLIENT;
      const step = { seq: steps.length, from, to: laneId, label, kind, callId: e.id, status: null, exception: null };
      steps.push(step);
      byCallId.set(e.id, step);
      stack.push({ laneId, callId: e.id, isRoot: !!req });
    } else if (e.event === 'return') {
      const top = stack.pop();
      const step = top && byCallId.get(top.callId);
      if (step) {
        const resp = e.http_server_response;
        if (resp) {
          const st = resp.status ?? resp.status_code ?? null;
          step.status = st;
          if (top.isRoot && st != null) finalStatus = st;
        }
        if (Array.isArray(e.exceptions) && e.exceptions.length) {
          const ex = e.exceptions[0];
          step.exception = short(ex.class) || ex.class || 'Exception';
        }
      }
    }
  }
  return { steps, lanes, finalStatus, rootPath, rootMethod };
}

// ---- diff -----------------------------------------------------------------
// A step's identity for set-diffing is (from-lane, to-lane, label). We compare the
// multiset of identities to find dropped / added edges, and compare final status.
const identity = (s, lanes) => `${lanes.label.get(s.from)}→${lanes.label.get(s.to)}:${s.label}`;

function diff(base, head) {
  const bKeys = base.steps.map((s) => identity(s, base.lanes));
  const hKeys = head.steps.map((s) => identity(s, head.lanes));
  const bSet = new Set(bKeys), hSet = new Set(hKeys);
  const dropped = base.steps.filter((s) => !hSet.has(identity(s, base.lanes)));
  const added = head.steps.filter((s) => !bSet.has(identity(s, head.lanes)));
  const exceptions = head.steps.filter((s) => s.exception);
  const statusChanged = base.finalStatus !== head.finalStatus;
  const breaking = statusChanged || dropped.length || added.length || exceptions.length;
  // The divergence index in HEAD: first added edge or first exception, else where it stops.
  let divergeAt = head.steps.findIndex((s) => s.exception || !bSet.has(identity(s, head.lanes)));
  if (divergeAt < 0 && statusChanged) divergeAt = head.steps.length - 1;
  return { dropped, added, exceptions, statusChanged, breaking, divergeAt };
}

// ---- mermaid rendering ----------------------------------------------------
function renderMermaid(model, { title, highlight }) {
  const L = model.lanes;
  const lines = [];
  lines.push('sequenceDiagram');
  lines.push(`    autonumber`);
  for (const id of L.order) lines.push(`    participant ${id} as ${L.label.get(id)}`);

  const arrowFor = (s) => (s.exception ? '-x' : '->>');
  const openRect = highlight && highlight.at >= 0;

  model.steps.forEach((s, i) => {
    if (openRect && i === highlight.at) lines.push('    rect rgb(255, 224, 224)');
    lines.push(`    ${s.from}${arrowFor(s)}${s.to}: ${s.label}`);
    if (s.kind === 'http' && s.status != null && !s.exception) {
      // response note added after children render; handled below via status on root.
    }
    if (s.exception) {
      lines.push(`    Note over ${s.to}: 💥 throws ${s.exception}`);
    }
    if (openRect && highlight.note && i === highlight.at) {
      lines.push(`    Note over ${s.to}: ${highlight.note}`);
    }
    if (openRect && i === highlight.at) lines.push('    end');
  });

  // Final response back to the client.
  const root = model.steps.find((s) => s.kind === 'http');
  if (root) {
    const st = model.finalStatus;
    const appLane = root.to;
    const client = model.steps[0]?.from || 'Client';
    const ok = typeof st === 'number' && st >= 200 && st < 300;
    lines.push(`    ${appLane}-->>${client}: ${st == null ? '(no response)' : st}${ok ? ' ✅' : ' ⛔'}`);
  }
  return lines.join('\n');
}

// ---- report ---------------------------------------------------------------
function report({ base, head, d, title, name }) {
  const out = [];
  out.push(`# ${title}`);
  out.push('');
  const verdict = d.breaking
    ? `**Behavioral change detected.** \`${name}\` returns **${fmt(base.finalStatus)} → ${fmt(head.finalStatus)}**.`
    : `No behavioral change: \`${name}\` is stable (${fmt(base.finalStatus)}).`;
  out.push(verdict);
  out.push('');
  out.push('## Before');
  out.push('');
  out.push('```mermaid');
  out.push(renderMermaid(base, { title: `${name} — before`, highlight: null }));
  out.push('```');
  out.push('');
  out.push('## After');
  out.push('');
  const note = head.steps[d.divergeAt]?.exception
    ? `✗ ${fmt(head.finalStatus)} — path stops here`
    : (d.statusChanged ? `✗ ${fmt(head.finalStatus)}` : 'changed here');
  out.push('```mermaid');
  out.push(renderMermaid(head, { title: `${name} — after`, highlight: { at: d.divergeAt, note } }));
  out.push('```');
  out.push('');
  out.push('## What changed');
  out.push('');
  if (d.statusChanged) out.push(`- **Response ${fmt(base.finalStatus)} → ${fmt(head.finalStatus)}** on \`${base.rootMethod} ${base.rootPath}\`.`);
  for (const s of d.exceptions) out.push(`- **Exception introduced:** \`${s.label}\` now throws \`${s.exception}\`.`);
  for (const s of d.added) out.push(`- **New step:** \`${labelOf(s, head)}\` appears on the path.`);
  for (const s of d.dropped) out.push(`- **Step no longer runs:** \`${labelOf(s, base)}\` is gone (code below it is never reached).`);
  if (!d.breaking) out.push('- Nothing — before and after are behaviorally identical.');
  out.push('');
  return out.join('\n');
}

const fmt = (s) => (s == null ? 'no response' : String(s));
const labelOf = (s, m) => `${m.lanes.label.get(s.from)} → ${m.lanes.label.get(s.to)}: ${s.label}`;

// ---- main -----------------------------------------------------------------
function main() {
  const { base: baseP, head: headP, opts } = parseArgs(process.argv.slice(2));
  const base = analyze(JSON.parse(readFileSync(baseP, 'utf8')));
  const head = analyze(JSON.parse(readFileSync(headP, 'utf8')));
  const name = opts.name || basename(headP).replace(/\.appmap\.json$/, '');
  const title = opts.title || `Behavioral diff — ${base.rootMethod || ''} ${base.rootPath || name}`.trim();
  const d = diff(base, head);
  const md = report({ base, head, d, title, name });
  if (opts.out) { writeFileSync(opts.out, md); console.error(`Wrote ${opts.out}`); }
  else process.stdout.write(md + '\n');
  // Exit non-zero when a break is detected, so this can gate CI.
  process.exit(d.breaking ? 1 : 0);
}

main();
