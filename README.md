# AppMap visualizations

Turn AppMap recordings into pictures a reviewer can read — in plain language, with
every class and call explained, for developers and non-developers alike. The tools
draw facts from the recordings; they do not judge whether a change is good or bad
(that stays with `appmap-review` and the people reviewing).

## The set

| Tool | Use it when | Audience |
| --- | --- | --- |
| [`behavior-diff/`](behavior-diff/) | an existing flow **changed** — show before/after | reviewers + non-devs |
| [`explain-trace/`](explain-trace/) | a **new** blessed gold trace — explain what a feature does and touches | product, security, compliance, owners |
| [`bin/appmap-diff-mermaid.mjs`](bin/appmap-diff-mermaid.mjs) | a change diff straight from a raw `.appmap.json` (no sequence-export step), surfacing HTTP/SQL/exceptions | reviewers |

`behavior-diff` and `explain-trace` read AppMap **sequence exports** (`appmap
sequence-diagram <recording> --format json`). `behavior-diff` also reads a native
`*.diff.sequence.json` from `appmap compare`. All three are dependency-free Node
scripts and output Mermaid (which GitHub renders inline) or plain text.

## The rules the tools follow

1. **Plain language. No jargon, no AI-speak.** Say what a thing does in a reviewer's
   words.
2. **Explain every part.** Each tool prints a list of every part it shows and leaves
   a blank for one plain sentence — fill it from the source; never guess.
3. **Two audiences.** The terminal (ASCII) output is for developers: terse, with a
   code reference. The diagrams are for everyone: technical labels translated to
   plain phrases, anything sensitive flagged.
4. **Reason from structure and labels, never from a value.** Recorded values are
   sanitized tokens, so the output is safe to paste into a public PR.

## Grounded in AppMap's own model

Node types, the `diffMode` change markers, the HTTP/SQL field names, the diff
palette, and the reviewer-report contract all match `@appland/sequence-diagram` and
the `appmap-review` skill, so these tools slot into the existing pipeline: `appmap
compare` produces the data, the review reasons about it, these draw it.

## Try it

```sh
# a change to an existing flow
node behavior-diff/behavior-diff.mjs before.sequence.json after.sequence.json --format before-after

# a new feature's gold trace, for a non-developer
node explain-trace/explain-trace.mjs feature.sequence.json --title "what this feature is"
```

Each tool has its own `README.md` and `SKILL.md`, and a `test/` you can run with
`node test/run.mjs`. Start with [`SKILL.md`](SKILL.md) for the whole set.
