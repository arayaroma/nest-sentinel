---
name: sdd-phase-dag
description: Use when working on any change tracked under .sdd/changes/ — explains the mandatory phase order (init, explore, proposal, spec/design, tasks, apply, verify, archive) and how it is enforced by hooks.
---

# SDD Phase DAG

This project is under SDD Harness enforcement. A PreToolUse hook hard-blocks
writes that skip phases. This is not advisory — violations are denied by the
hook, not just discouraged.

## Phase order (stages)

1. `init` — `sdd init <change-id>` creates `.sdd/changes/<id>/` and state.
2. `explore` — research, read code, understand the problem. Mark complete with `sdd phase done explore`.
3. `proposal` — write `.sdd/changes/<id>/proposal.md`. Completing this file auto-marks the phase.
4. `spec` and `design` (parallel stage) — write `spec.md` then `design.md` (design.md requires spec.md to exist — see the sdd-artifact-deps skill).
5. `tasks` — write `tasks.md`.
6. `apply` — write actual project code. BLOCKED until `tasks.md` and `ac.md` both exist. `tasks.md` must list every touched file under a `## Files` section — `sdd phase done apply` fails closed if any listed file has no paired test (default `src/X.ts` → `tests/X.test.ts`, configurable via `.sdd/config.json`) or if the test suite doesn't pass. Missing-test failures name the exact test file to write; consult spec.md/design.md/ac.md for expected behavior before writing it. Pass `--auto-fix` (or set `.sdd/config.json.autoFix: true`) to have dar-ai attempt to generate the missing test itself via Claude before failing — one attempt, then a normal re-check; without the flag, behavior is unchanged (local-only, no network calls).
7. `verify` — run tests, write `evidence.md` with proof (test output, logs). `sdd phase done verify` re-runs the same TDD gate as `apply` (same `## Files` coverage + passing suite) as a regression check before completing. dar-ai also automatically reads evidence.md after a successful check and asks Claude whether anything is worth logging as a learning — no flag needed; it's a no-op (no network call) if evidence.md is empty. Run `sdd usage report` to see what auto-generated calls (TDD auto-fix and this) have cost so far.
8. `archive` — write `archive.md` summarizing the shipped change. Writing the file auto-marks the phase via the PostToolUse hook — but that hook only marks completion, it does not run learning capture. **Run `sdd phase done archive` explicitly afterward** to trigger the same automatic learning capture as verify (reading archive.md instead of evidence.md); skipping that command means archive-phase learning capture never happens, even though the phase itself shows complete.

## Commands

- `sdd init <change-id>` — start a new change.
- `sdd phase done <phase>` — mark a no-artifact phase (init/explore/apply/verify) complete. Fails if the previous stage isn't complete.
- `sdd status [change-id]` — show current phase and completed phases.

## What happens on violation

A PreToolUse hook denies the tool call (exit code 2) with a message stating
exactly which file or phase is missing. Read the message and write the
missing artifact/run the missing command before retrying — do not attempt
to work around the block.
