---
name: behavior-diff
description: >
  Render an AppMap behavioral diff a reviewer can read in ten seconds — a
  plain-English summary plus a picture of what changed and where. Use when two
  recordings of the same flow (a baseline and a current sequence export) need to
  be compared and shown: as an ASCII call graph in the terminal, a single Mermaid
  diff diagram, or a before/after pair for a GitHub PR. Change status comes from
  the recordings' own subtreeDigest/digest — it draws facts, it does not judge.
---

# behavior-diff

The render step of the gold-trace / `appmap-review` pipeline. Given two recordings
of the same flow, it shows **what changed at runtime and where** — one plain
sentence on top, one small picture underneath. It does not decide whether a change
is good or bad; that judgment stays with `appmap-review` and the human.

## When to use it

- A gold-trace compare or CI recording reports a changed trace and you want the
  human-readable picture, not a wall of JSON.
- You are reviewing a PR and want a before/after the reviewer reads in seconds,
  pasted straight into the conversation (GitHub renders Mermaid natively).
- You want to gate CI on "did runtime behavior change" (the tool exits non-zero).

## Inputs — two sequence exports of the *same* flow

Record the same test on each revision and export each with:

```sh
appmap sequence-diagram <recording>.appmap.json --format json > <name>.sequence.json
```

- **baseline** — before the change. **current** — after it.
- Both must be recorded with the **same capture config** (SQL on, labels applied),
  or instrumentation drift swamps the behavioral diff.

## Run it

```sh
node behavior-diff.mjs <baseline>.sequence.json <current>.sequence.json \
  --format ascii|mermaid|before-after|all \
  --title "<one line: what this flow is>" [--cap N] [--exclude a,b]
```

- `ascii` for the terminal, `mermaid` for a single diff diagram, `before-after`
  for the side-by-side pair, `all` for everything.
- **Exit 0 = identical, 1 = behavior changed** — usable as a CI gate.

## Read the picture — then hand judgment back

The tool draws facts. Deciding whether a change is acceptable is the reviewer's
job (or `appmap-review`'s):

1. The plain-English line says *what* moved; the diagram says *where*. A `🔐`
   marks a change on a **security-labeled** path — treat those as the ones to
   look at first.
2. In the before/after view, the red band on the *before* side is code that no
   longer runs; the amber/green bands on the *after* side are what changed or is
   new. Ask what the new path's destination actually is for the user.
3. If acceptability depends on product or architecture policy, say so and route it
   to the owner — don't bless a change just because the picture is clear.

## How it decides (no guessing)

Change status comes from each call's `subtreeDigest` (whole branch) and `digest`
(the call itself): matching subtree digest ⇒ unchanged, folded away; differing ⇒
descend. Captured values are sanitized tokens, so reason from structure and labels,
never from a value. See `README.md` for the native-`diffMode` alternative and the
handoff notes for the AppMap team.
