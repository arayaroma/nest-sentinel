---
name: session-summary
description: Use at the start of a new session in a project with a .sdd/ directory, or right after a context compaction, to recover recent project state before re-deriving it from scratch. Also use for "what's the current state of this project" / "what happened recently" questions.
---

# Session Summary (Compaction Recovery)

Every change appends a rollup entry to `.sdd/session-summary.md` (newest first) the moment its
`archive` phase completes — status, executive summary, touched artifacts, recommended next
steps, and known risks, all derived from that change's `result.json` (see
`result-contract` harness). No manual step needed for the common path — `sdd phase done archive`
writes the entry automatically.

## When to read it

- Start of a fresh session in a project that already has `.sdd/`.
- Immediately after a context compaction, before continuing prior work.
- Before answering "what's the state of X" without first grepping change directories by hand.

## How

Read `.sdd/session-summary.md` directly (newest entries first), or run:

```
sdd session summary show [--last N]
```

Prints entries as JSON, most-recent-first. Omit `--last` to print everything. Empty/no-history
projects print nothing — that's normal, not an error.
