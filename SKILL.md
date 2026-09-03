---
name: appmap-visualizations
description: >
  Turn AppMap recordings into pictures a reviewer can read, in plain language, with
  every class and call explained. Two views: behavior-diff, for when an existing
  flow changed (before/after); and explain-trace, for a newly blessed gold trace (a
  new feature), written so a non-developer — product, security, compliance, an
  owner — can understand it. Use when someone needs to SEE what a change did, or
  what a new feature does, without reading the code.
---

# AppMap visualizations

A small set of tools that turn AppMap recordings into reviewer-ready pictures. They
draw facts from the recordings. They do not judge whether a change is good or bad —
that stays with `appmap-review` and the people reviewing.

## The two views

- **`behavior-diff/`** — an existing flow **changed**. Give it two recordings of the
  same test (before and after) and it shows what moved: a before/after pair of
  diagrams, or a single diff diagram, or a terminal list. Use it in a pull request
  or CI (it exits non-zero when behavior changed).

- **`explain-trace/`** — a **new** blessed gold trace (a new feature, no "before").
  Give it one recording and it explains, in plain language, what the feature does
  step by step and what it touches (login checks, personal data, the database,
  outside services). Written for people who are not developers.

Both take AppMap **sequence exports** — the JSON from
`appmap sequence-diagram <recording> --format json`.

## The rules these tools follow (and you should too when using them)

1. **Plain language. No jargon, no AI-speak.** Say what a thing does in the words a
   reviewer uses. "Checks your login," not "authenticates the principal."
2. **Explain every part.** If a reviewer might not know what a class or a call is,
   explain it in one plain sentence. The tools print a list of every part shown and
   leave a blank for that sentence — fill each one from the source. If you can't say
   what something does from the code, say that; do not guess.
3. **Two audiences, two treatments.** The terminal (ASCII) output is for developers:
   keep it terse, add a code link (`path:line`) instead of a long explanation. The
   diagrams are for everyone, including non-developers: translate technical labels
   into plain phrases, and flag anything sensitive.
4. **Reason from structure and labels, never from a value.** Recorded values are
   sanitized tokens, so the output is safe to paste into a public PR.
5. **Same recording setup on both sides of a diff** (SQL capture on, labels
   applied), or the diff shows recording drift instead of real change.

## Where each tool documents itself

- `behavior-diff/SKILL.md` and `behavior-diff/README.md`
- `explain-trace/SKILL.md` and `explain-trace/README.md`
- `bin/appmap-diff-mermaid.mjs` — a variant of behavior-diff that reads the raw
  `.appmap.json` recording directly (no sequence-export step) and surfaces web
  facts (HTTP status flips, dropped SQL, exceptions); see the root `README.md`.

## For the AppMap team

Handoff notes (native `diffMode` vs. two-side digests, the real Waltz palette, and
folding web semantics into the sequence-export path) are in each tool's file header
and README. The intended home is the `appmap-review` skill: the review reasons, these
tools draw.
