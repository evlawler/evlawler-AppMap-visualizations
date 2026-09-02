---
name: explain-trace
description: >
  Explain one AppMap gold trace — a newly blessed "this is how the feature works"
  recording — in plain language for people who are not developers: product,
  security, compliance, owners. Produces a "what it touches" panel (login checks,
  personal data, database, outside services), a step-by-step walkthrough, and a
  simple picture. Use when a new feature has a gold trace and non-developers need
  to understand what it does and what it reaches, without reading code.
---

# explain-trace

The companion to `behavior-diff`. Where behavior-diff shows how an existing flow
*changed*, explain-trace explains a *new* flow from a single recording, written so a
non-developer can follow it. It reports what the recording shows; it does not judge
and it does not guess.

## When to use it

- A new feature just got a blessed gold trace and product/security/compliance/an
  owner needs to understand it.
- You want a plain-English "what does this reach?" for a PR, without asking a
  reviewer to read a sequence diagram cold.

## Input

One AppMap sequence export: `appmap sequence-diagram <recording> --format json`.

## Run it

```sh
node explain-trace.mjs <trace>.sequence.json --format brief|mermaid|all \
  --title "<what this feature is, in a person's words>" [--cap N] [--exclude a,b]
```

## Your job when you use it — write the plain sentences

The tool leaves three blanks on purpose, because only a person (with the source and
the PR) can fill them honestly:

1. **The one-line "what a person gets."** One plain sentence, in the user's terms —
   "A member can email their profile to someone outside the team." Not "invokes the
   share endpoint."
2. **Each step.** One plain sentence per notable step: what it is, in words a
   non-developer uses. No jargon.
3. **Each part (code area).** One plain sentence: what this module is and does here.

Rules: plain language, no AI-speak, no jargon. If you cannot say what something does
from the code, say that — do not guess. Lead the reader with the **What it touches**
panel; for a security or compliance reader that is the whole point — it says whether
this feature reaches login, personal data, the database, or an outside service.

## How "touches" is decided

From the recording's structure and labels, never from a value: a Query node → the
database; a ServerRPC/ClientRPC node → an outside call; `security.authentication` /
`authorization` → a login or permission check; `security.pii` → personal data;
`io.file` → files. Values are sanitized tokens, so the output is safe to publish.
