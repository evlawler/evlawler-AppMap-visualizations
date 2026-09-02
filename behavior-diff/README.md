# behavior-diff — read an AppMap behavioral diff in plain English

A small, dependency-free tool that turns an AppMap "what changed at runtime"
comparison into something a person can read in about ten seconds — as an ASCII
graph in the terminal, as a single Mermaid diff diagram, or as a **before/after
pair** that renders right inside a GitHub pull request.

This is the consolidated best-of two prototypes (see *Provenance* below). Handed
over for the AppMap team (Kevin & co.) to review and, if useful, pull into the
`appmap-review` skill.

## The problem it solves

Two recordings of the same test — one from before a change, one from after —
each describe how the code actually ran. Comparing them tells you whether the
behavior changed. But the raw comparison is a wall of JSON. A reviewer wants one
plain sentence and one small picture: *what changed, and where.* That's all this
tool does — it **draws facts, it does not judge** (interpretation stays in
`appmap-review`).

## What it produces

Give it two AppMap sequence exports (baseline and current). It gives you, in your
choice of format, always opening with the same plain-English line:

> Runtime behavior changed: 1 call(s) changed, 1 added, 1 no longer happen. ⚠ 1 on a security-labeled path.

- **`--format ascii`** — terminal. Indented calls, each marked `~` changed, `+`
  added, `-` removed, `·` unchanged. Security-labeled changes are flagged `🔐`.
- **`--format mermaid`** — one diff diagram for github.com: changed/added in an
  amber band, removed in a red band, unchanged runs folded to a count.
- **`--format before-after`** — **two** diagrams, the baseline path and the
  current path side by side, each highlighting where it differs. This is the
  "what did the code do before, and what does it do now" view.
- **`--format all`** — ascii, then before/after, then the single diff.

**Exit code: 0 if nothing changed, 1 if a change is detected** — so it can gate CI:

```sh
node behavior-diff.mjs base.sequence.json cur.sequence.json --format ascii || echo "behavior changed"
```

## How to run it

```sh
# Terminal
node behavior-diff.mjs baseline.sequence.json current.sequence.json \
  --format ascii --title "what this trace is about"

# GitHub (paste the output straight into a PR)
node behavior-diff.mjs baseline.sequence.json current.sequence.json \
  --format before-after --title "what this trace is about"
```

The inputs are AppMap **sequence exports** — the JSON from
`appmap sequence-diagram <recording> --format json`. Run it once for the "before"
recording and once for the "after". No install, no packages — only Node's built-in
file reader. Flags: `--cap N` (row/event cap, default 200), `--exclude a,b`
(drop pure-presentation calls).

## How it decides what changed

It never guesses. Every call carries `digest` (its own identity) and
`subtreeDigest` (it *and everything under it*). Where a subtree's `subtreeDigest`
matches on both sides, the whole branch is **unchanged** — folded away, not
descended. Where it differs, the tool walks in and uses `digest` to tell whether
*this* call changed or only something beneath it did. Captured values are
sanitized tokens at record time, so the output is safe to paste into a public PR —
and you reason from structure and labels, never from a value's contents.

**Labels carry the meaning.** A changed `security.authentication` call matters far
more than a changed formatting helper, so security-labeled changes get the
strongest callout (`🔐`) and are counted separately in the summary.

## Preconditions

- **Same capture config on both sides** (SQL capture on, labels applied). If the
  config differs between baseline and current, the "diff" is swamped by
  instrumentation drift, not behavior. If you see churn that doesn't match the
  source diff, suspect config drift first.
- **A gold trace asserts *correct* behavior** — never enshrine a bug as one. The
  lifecycle is pin → flip → graduate: pin the wrong behavior as a characterization
  test, flip the assertion when the fix lands, then graduate it into a gold trace.

## Notes for the AppMap team

1. **Native `diffMode` vs. two-side digests.** `appmap compare` already writes a
   per-call `diffMode` (a bare number 1/2/3 in the recordings we had) into each
   `report/diff/*.diff.sequence.json`. Decoding that enum directly is the cleaner
   path — but the number→meaning mapping wasn't documented where this was written,
   and a wrong guess flips added/removed, so we used digests. The team owns that
   enum (`@appland/sequence-diagram`): the ideal is to **support both** — decode
   `diffMode` when handed one diff export, compute digests when handed two sides,
   same renderer either way.
2. **Real Waltz styling.** The amber/red bands approximate the "Live Trace
   Placements" / Waltz treatment on appmap.io — swap in the real palette + wording.
3. **Web semantics.** HTTP status flips (200→403), dropped SQL reads, and thrown
   exceptions make "breaking" legible. The companion raw-`.appmap.json` variant
   (`../bin/appmap-diff-mermaid.mjs`) surfaces those from the event tree; folding
   them in here depends on whether the sequence export carries them as first-class
   fields — confirm the schema before adding, rather than guess it.

## Where it fits in `appmap-review`

`appmap-review` already reads the change report + per-trace diff diagrams and
writes the *interpreted* review (regression? intended? side effect?).
`behavior-diff` is the **render step** of that same pipeline: once the review has
decided what a change means, this draws it — ASCII for a terminal run, Mermaid for
the PR comment — with the plain-English summary on top. The review reasons; the
renderer draws. Keep that line.

## Provenance

Consolidated from two prototypes:

- **W2SE build** — the digest/LCS diff engine, ASCII output, unchanged-collapse,
  and the design notes (label-awareness, collapse-before-cap, the `diffMode`
  decision).
- **AppMap-visualizations build** — the before/after pair view, CI exit-code
  gating, the test harness, and a raw-`.appmap.json` variant with a worked JWT
  example (`../bin/appmap-diff-mermaid.mjs`, which needs no sequence-export step
  and surfaces HTTP/SQL/exception semantics directly).
