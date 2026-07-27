---
name: dar-docs-recall
description: Use before starting any non-trivial research task (a WebSearch/WebFetch-heavy investigation of pricing, limits, best-practices, or an architecture pattern — not a simple factual lookup) to check dar-docs first via `sdd doc search`, and after finishing research worth keeping to save it via `sdd doc save`. Also triggers on "check dar-docs", "did I research this already", "look this up in my docs".
---

# dar-docs Recall Harness

Research findings get saved to the `dar-docs` repo (`sdd doc save`), but that's
only useful if they get checked before re-researching and saved after finishing.
This skill makes both halves the default, not something the user has to ask for.

## Workflow

1. **Before researching a topic that plausibly has prior coverage**, derive
   keywords and run `sdd doc search <keywords>`. If a recent, relevant doc
   exists, use it instead of re-researching from scratch — tell the user it's
   from a prior session, and flag if it looks stale enough to warrant a
   refresh (check its `updated_at`/tags against how fast the topic moves).
2. **After completing a research task whose findings are worth keeping** (an
   investigation the user asked for, not a one-line fact lookup), save it via
   `sdd doc save <file> --category research [--project <name>] [--title ...]
   [--tags a,b,c]` as the default — don't wait to be asked. Use judgment on
   triviality, same stance as `sdd-learning`'s "if in doubt, log it."
3. **When telling the user findings were saved**, mention the `sdd doc
   search` keywords that would surface it again later, so future-session
   recall is discoverable.

## Command reference

- `sdd doc search <query>` — free-text search over title/tags/category/project,
  prints matches with path + metadata. No matches → "no matching docs found".
- `sdd doc list [--category <c>] [--project <p>] [--json]` — full/filtered
  listing.
- `sdd doc save <file> [--category security|research|general] [--project
  <name>] [--title <title>] [--source-url <url>] [--tags a,b,c]` — save a new
  doc (or update an existing one at the same category/project/slug).
