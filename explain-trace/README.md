# explain-trace — explain a new gold trace to people who aren't developers

When a **new** feature gets a blessed gold trace, there's no "before" to diff — but
product, security, compliance, and owners still need to understand what it does.
This reads one recording and explains it in plain language: what the feature does
step by step, and — the part those readers care about most — **what it touches**.

It reports what the recording shows. It does not judge and it does not guess.

## What it produces

```sh
node explain-trace.mjs feature.sequence.json --title "Share your profile by email"
```

- A one-line "what a person gets from this" (left blank for you to fill — the tool
  won't invent intent).
- **What it touches** — the risk-relevant facts, read from the recording:
  - **Security & access** — checks who you are or what you're allowed to do
  - **Personal data** — reads or handles someone's personal data
  - **Database** — reads or writes the database
  - **External services** — calls a service outside this app
  - **Files** — reads or writes files
- **Step by step** — the main steps in order, each tagged with what it touches and
  any hard fact (the HTTP result, "database query").
- **The parts (code areas)** — every code area, with a blank for one plain sentence.

`--format mermaid` gives a simple sequence picture for a PR (each step noted with
what it touches); `--format all` gives both.

Input is one AppMap sequence export (`appmap sequence-diagram <recording> --format
json`). Dependency-free. Recorded values are sanitized tokens, so it's safe to paste
into a public PR.

## How it decides what a step "touches"

From the node's own type and labels — the same real schema `behavior-diff` uses: a
Query node means the database; a ServerRPC/ClientRPC node means an outside call; a
`security.authentication`/`authorization` label means a login or permission check;
`security.pii` means personal data; `io.file` means files. Nothing is inferred from
values. If nothing sensitive is labeled, it says so, and reminds you to check that
labels were applied when recording.

## Reading it as a non-developer

The **What it touches** panel is the headline: it tells a security or compliance
reviewer, without reading code, whether this feature reaches anything they own. The
step-by-step is the story. The parts list is the glossary — each line gets one plain
sentence from whoever knows the code, so a reader never hits a name they can't place.
