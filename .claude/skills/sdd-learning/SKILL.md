---
name: sdd-learning
description: Use whenever anything important or interesting surfaces during a change — not just bugs. Wrong assumptions, surprising behavior, non-obvious gotchas, rejected approaches, design trade-offs, anything a future session would benefit from knowing. Also use before proposing a fix for anything that smells like a repeat issue — search first.
---

# SDD Learning Harness

Anything important or interesting hit during a change gets recorded in
`.sdd/learning.db` (SQLite, separate from phase state). This is not
optional documentation, and it is not limited to bugs — this is not
advisory, treat a miss here the same as skipping a phase gate.

## What counts as worth learning

Broader than "bug fixed." Record it if it's any of:
- A bug and its root cause (the obvious case).
- A wrong assumption that cost time to discover.
- Surprising behavior — a library, API, or existing code doing something
  non-obvious.
- A design decision with real trade-offs, even if nothing broke.
- A rejected approach and why it was rejected (saves re-deriving the same
  dead end later).
- A gotcha specific to this stack/environment that isn't written down
  anywhere else.

If in doubt, log it — the cost of an unused record is near zero, the cost
of re-discovering the same thing from scratch is not.

## Workflow

1. **Before fixing anything non-trivial**, search for prior occurrences:
   `sdd learn search "<keywords>"` — if a matching problem has an accepted
   solution, start there instead of re-deriving it.
2. **When a problem is confirmed**, record it:
   `sdd learn problem "<name>" "<description>" [--change <change-id>]`
3. **Once the root cause is identified**:
   `sdd learn cause <problem-id> "<description>" [--date YYYY-MM-DD]`
4. **For each candidate fix considered** (record all candidates, not just the
   winner — future search benefits from seeing what was tried and rejected):
   `sdd learn solution <cause-id> "<name>" "<description>" [--files a.ts,b.ts]`
5. **Once a solution ships**:
   `sdd learn accept <cause-id> <solution-id>`
6. **What this taught, generalized beyond this one instance**:
   `sdd learn learning <problem-id> "<description>"`
7. **Anything noticed later that refines the record** (a recurrence, a
   caveat, a correction) is an observation — observations can nest on other
   observations, so a correction to a correction is still tracked:
   `sdd learn observe "<description>" [--date YYYY-MM-DD] [--cause id] [--solution id] [--learning id] [--parent id] [--ttl-days N]`
   Observations expire (default 30 days, max 45) since the underlying issue
   may get resolved a better way before anyone revisits the record. `search`
   marks expired ones `[STALE — review, may be fixed differently now]`. If a
   stale observation still holds, push its expiry out instead of re-logging it:
   `sdd learn observe-extend <observation-id> <ttl-days>`

## Automatic capture

`sdd phase done verify` and `sdd phase done archive` automatically ask
Claude whether their artifact (`evidence.md` / `archive.md`) contains
anything worth logging, and persist it via the same problem/cause/solution/
learning chain described above — no manual `sdd learn ...` commands needed
for those cases. This still runs alongside manual logging; use `sdd learn
search` to check what's already captured before adding more by hand. See
`sdd usage report` for what these automatic calls have cost. Each phase
only captures once per change — a marker file (`.sdd/changes/<id>/.learning-captured-<phase>`)
skips re-running it (and re-billing) on a repeat `sdd phase done verify`/`archive`.
`archive`'s capture requires explicitly running `sdd phase done archive` —
the PostToolUse hook auto-marking the phase on `archive.md` write does not
trigger it.

## Data model

```
workflow(id, change_id)
  problem(id, workflow_id, name, description, created_at)
    cause(id, problem_id, description, problem_date, accepted_solution_id)
      solution(id, cause_id, name, description, referenced_files)
    learning(id, problem_id, description, created_at)
    observation(id, problem_date, cause_id?, solution_id?, learning_id?, parent_observation_id?, description)
      — observations can reference other observations recursively
```

## Command reference

- `sdd learn problem "<name>" "<description>" [--change <id>]`
- `sdd learn cause <problem-id> "<description>" [--date YYYY-MM-DD]`
- `sdd learn solution <cause-id> "<name>" "<description>" [--files a.ts,b.ts]`
- `sdd learn accept <cause-id> <solution-id>`
- `sdd learn learning <problem-id> "<description>"`
- `sdd learn observe "<description>" [--date YYYY-MM-DD] [--cause id] [--solution id] [--learning id] [--parent id] [--ttl-days N]` (default 30, max 45)
- `sdd learn observe-extend <observation-id> <ttl-days>` — push expiry out from today
- `sdd learn search "<query>"` — matches problem name/description, prints causes (with accepted solution flagged), solutions, and learnings.
