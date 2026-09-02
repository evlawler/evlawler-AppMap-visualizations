---
name: appmap-diff-diagram
description: >
  Turn an AppMap behavioral diff into a before/after Mermaid picture of the code
  area a change breaks. Use when a change flips a request's outcome (e.g. 200 → 403,
  a query disappears, a function starts throwing) and you want to SEE the path the
  old code took and the path the new code takes, side by side, with the breaking
  step highlighted. Input is two recordings of the same flow — base and head
  `.appmap.json` — and the output is Markdown with two ```mermaid sequence diagrams.
---

# AppMap diff diagram

This skill answers one question visually: **when a change breaks a flow, what did the
code do before, what does it do now, and exactly where does it diverge?**

It reads the `.appmap.json` event tree directly, so it works on any project that
records AppMaps — no AppMap CLI, no puppeteer, no network. The picture is Mermaid, so
it renders in GitHub, in most Markdown viewers, and pastes straight into a deck.

## When to use it

- A gold-trace compare (or a CI recording) reports a changed trace and you want the
  human-readable picture of the change, not just a status line.
- You are reviewing a PR and a request's outcome moved (status flip, a downstream
  call or SQL query that no longer runs, a new exception on the path).
- You are workshopping "what broke" with a team and need a before/after they can read
  in five seconds.

## Inputs — two recordings of the *same* flow

You need the same test/flow recorded twice:

- **base** — the recording on the code before the change (the known-good baseline).
- **head** — the recording on the code after the change.

Get them however your project already records AppMaps:

- **Gold traces:** the committed baseline is your `base`; re-record the same flow on
  the branch to get `head`.
- **`appmap archive` + compare:** extract the two archives and take the matching
  `<flow>.appmap.json` from each (`base` archive and `head` archive).
- **Ad hoc:** run the same integration test on each revision with the AppMap agent on,
  and take the two `.appmap.json` files it writes.

The two files must be the **same flow** — same request, same test. Diffing two
different flows produces a misleading picture.

## Run it

```bash
node bin/appmap-diff-mermaid.mjs <base.appmap.json> <head.appmap.json> \
  --name "<flow name>" \
  --title "<one-line description of the change>" \
  --out diff.md
```

- Writes a Markdown file with a **Before** diagram, an **After** diagram (the
  divergence wrapped in a red block and annotated), and a **What changed** list.
- **Exit code 1 when a break is detected, 0 when the flow is behaviorally identical** —
  so you can gate CI on it (`node bin/appmap-diff-mermaid.mjs base head || echo "changed"`).

## Read the picture — then judge

The diagram shows you *that* the flow changed and *where*. Deciding whether the change
is acceptable is the reviewer's job, and the picture is built to make that judgment
possible:

1. **Find the divergence** — the highlighted step in the After diagram is where the two
   paths split. Everything below it in the Before diagram (the dropped steps in "What
   changed") is code the new path never reaches.
2. **Read the destination, not just the transition.** The After diagram ends on a
   response (e.g. `⛔ 403`). Ask what that destination actually is for the user: a
   usable outcome (a redirect to re-login, a graceful error) or a dead-end (a bare
   `4xx` with no recovery). If the flow now lands on a path another recording already
   witnesses, diagram *that* recording too and read its response.
3. **If the destination's acceptability is a product or architecture decision** (e.g.
   "is locking out every stale-token user acceptable, or should we redirect / run a
   migration window?"), say so and route it to the owner. Don't bless the change just
   because the picture is clear — a clear picture of a bad outcome is still a bad
   outcome.

## Notes

- The diagram is scoped to the HTTP request transaction (test-runner frames are
  dropped). For non-web AppMaps it falls back to the whole recording.
- Participants are the classes on the path; messages are the calls, SQL queries
  (summarized as `VERB table`), and the final response, in execution order.
- A `💥 throws` note marks a function that raised on the head path; a `-x` arrow marks
  the call that did not return normally.
