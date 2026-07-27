---
name: sdd-artifact-deps
description: Use when writing any artifact under .sdd/changes/<id>/ — explains which files each artifact depends on and what blocks a Write if a dependency is missing.
---

# SDD Artifact Dependencies

Each artifact in `.sdd/changes/<id>/` has file-level prerequisites, checked
by a PreToolUse hook independent of phase/stage. Even within a stage that
allows parallel phases (spec + design), individual files still have their
own dependency order.

## Dependency table

| Artifact | Requires (must already exist) |
|---|---|
| `proposal.md` | (none) |
| `spec.md` | `proposal.md` |
| `design.md` | `spec.md`, `proposal.md` |
| `tasks.md` | `spec.md`, `design.md` |
| `ac.md` | `tasks.md` |
| `evidence.md` | `spec.md`, `tasks.md` |
| `archive.md` | `evidence.md` |

Project code (anything outside `.sdd/`) requires `tasks.md` AND `ac.md` to
exist for the active change — this is the `apply` phase code gate.

## What happens on violation

Denied Write/Edit, stderr names the exact missing file and its path. Write
that file first, then retry the original write.
