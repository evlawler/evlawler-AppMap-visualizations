# AppMap visualizations

Workshop repo for turning AppMap behavioral data into pictures. First tool:
**a before/after Mermaid diagram of the code area a change breaks.**

When a change flips a request's outcome — `200 → 403`, a query that stops running, a
function that starts throwing — a status line in a diff report tells you *that* it
broke. This shows you the **path the old code took and the path the new code takes,
side by side, with the breaking step highlighted** — read directly off two AppMap
recordings of the same flow.

- Reads `.appmap.json` directly — no AppMap CLI, no puppeteer, no network.
- Output is Mermaid, so it renders on GitHub and pastes into a deck.
- Exits non-zero when a break is detected, so it can gate CI.

## Quick start

```bash
node bin/appmap-diff-mermaid.mjs <base.appmap.json> <head.appmap.json> \
  --name whoami_admin \
  --title "Externalize JWT secret breaks GET /api/user/whoami" \
  --out diff.md
```

`base` = recording before the change, `head` = recording of the **same flow** after it.
See [`SKILL.md`](SKILL.md) for how to obtain the two recordings (gold traces,
`appmap archive`, or an ad-hoc test run) and how to read and act on the picture.

## Worked example

[`examples/whoami_admin.diff.md`](examples/whoami_admin.diff.md) — a real diff from the
FINOS Waltz JWT scene: an AI coder "fixes" a hardcoded signing secret, tests stay green,
and every authenticated request silently flips `200 → 403`. The before diagram shows the
full authenticated path (`verifyAndGetSubject → SELECT roles → 200`); the after diagram
shows it collapse at the auth filter (`verify throws → 403`, the database never reached).

> Provenance of the sample: `base` is the committed `whoami_admin` baseline (the real
> 200 path). `head` in this bundled sample is the genuine invalid-signature recording
> (`whoami_rejected_token`) — the exact 403 path the broken build routes every
> authenticated request onto. In a normal run you would point `head` at the re-recording
> of `whoami_admin` on the patched branch; the picture is the same.

## Status

Early / workshop. The renderer covers HTTP request flows (web AppMaps) well; SQL is
summarized as `VERB table`. Feedback and rough edges expected — that's the point of the
repo for now.
