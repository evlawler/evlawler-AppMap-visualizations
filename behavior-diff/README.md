# behavior-diff — see how a flow's behavior changed, in plain language

Two recordings of the same test — one before a change, one after — describe how the
code actually ran. This turns the comparison into something a person reads in about
ten seconds: a plain sentence, a picture of what moved, and a list of every part so
nothing shown goes unexplained. It **draws facts; it does not judge** (that stays in
`appmap-review`).

Consolidated best-of two prototypes (see *Provenance*), then squared against
AppMap's own code so the schema, the change markers, and the colors are real.

## Two ways to give it input

- **Two sequence exports** (before + after). Change status is computed from each
  call's own `subtreeDigest`/`digest`: a branch whose digest matches on both sides
  is unchanged, full stop. No guessing.
- **One diff export** (`*.diff.sequence.json` from `appmap compare`). Change status
  is read straight from AppMap's native `diffMode` (`Insert=1` / `Delete=2` /
  `Change=3`) — the canonical source. Same renderer either way.

```sh
# two sides
node behavior-diff.mjs before.sequence.json after.sequence.json --format before-after
# one diff export
node behavior-diff.mjs whoami.diff.sequence.json --format ascii
```

Sequence exports come from `appmap sequence-diagram <recording> --format json`.

## What it produces

Always opens with one plain line anyone can read, e.g.:

> What changed: 2 steps now behave differently, 0 new, 1 no longer happen. 1 of these is on a security check — look there first.

- **`--format ascii`** — for the **terminal / developers**. Indented steps marked
  `~` different, `+` new, `-` gone, `·` same. Security steps flagged `🔐`. Each step
  carries a **code ref** (the stable id, e.g. `web/JWTUtilities.verifyAndGetSubject`)
  and any hard fact from the recording — the HTTP result (`GET /… → 403`), the SQL,
  or `throws`.
- **`--format mermaid`** — one diff diagram for a GitHub PR (paste it in).
- **`--format before-after`** — the old path and the new path, side by side.
- **`--format all`** — everything.

Below the diagrams, a **Parts shown here** list names every code area and moved step
and leaves a blank for one plain sentence each — the reviewer (or `appmap-review`)
fills them from the source. Nothing on screen is left unexplained.

**Exit code: 0 = identical, 1 = changed** — so it gates CI:

```sh
node behavior-diff.mjs before.sequence.json after.sequence.json --format ascii || echo "behavior changed"
```

## Plain language, two audiences

The terminal view is terse and developer-facing: a code ref, not a paragraph. The
diagrams are for everyone, including product/security/compliance/owners: technical
labels are translated (`security.authentication` → "login / identity check"), and a
security change is called out first. No jargon; if a part can't be named from the
code, it's left blank rather than guessed.

## What's real (checked against AppMap's own code)

- **Node types** are the numeric enum from `@appland/sequence-diagram`
  (Function=3, ServerRPC=4, Query=6, Loop=1), so HTTP `route`+`status`, the SQL
  `query`, loop `count`, and the raised-exception flag are read from the fields
  that actually exist.
- **Change markers** use the native `diffMode` (1/2/3) when given a diff export.
- **Colors** are AppMap's diff palette — added `#EBFEEE`, removed `#FCECEA`, changed
  a light blue echoing the webview's change color.
- **Code refs** are `stableProperties.id`. The sequence export has no `path:line`;
  turning the id into a clickable location needs the recording's `classMap` (the one
  remaining upgrade).

## Preconditions

- **Same capture config on both sides** (SQL capture on, labels applied), or the
  diff shows recording drift instead of behavior.
- **A gold trace asserts *correct* behavior** — never enshrine a bug. Lifecycle:
  pin → flip → graduate.

## Where it fits

This is the **render step** of the `appmap-review` pipeline. `appmap compare` writes
`change-report.json` + `report/diff/*.diff.sequence.json`; the review reasons about
what a change means and writes the findings report (severity table → numbered
findings with `file:line` + trace evidence → checks ledger); this draws the picture
that report points at. The review reasons; the renderer draws.

## Provenance

- **W2SE build** — the digest/LCS engine, ASCII output, unchanged-collapse, and the
  design notes (label-awareness, collapse-before-cap, the diffMode decision).
- **AppMap-visualizations build** — the before/after pair view, CI exit-code gating,
  the test harness, and a raw-`.appmap.json` variant (`../bin/appmap-diff-mermaid.mjs`).
- **AppMap's own repos** — the node-type enum, `diffMode`, the field names for
  HTTP/SQL, the diff palette, and the `appmap-review` report contract.
