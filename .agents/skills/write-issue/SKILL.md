---
name: write-issue
description: Decide whether a piece of work deserves a GitHub issue in this repo and write it as a ticket another agent can pick up. Use when the owner or the lead session files, splits or labels an issue.
---

# Write an issue

Issues are tickets for other agents. The rules a ticket's PR must meet are in the root `AGENTS.md`.

- Raise a GitHub issue only for **big** work: about M or L (half a day of human work or more, or several files), parallelizable and independently testable. Fix small things (S) directly instead of filing them: an issue costs a PR plus a review, which is more than a small fix.
- Every issue states the goal, the **files the PR may touch** (and must not), and acceptance criteria that are each checkable with a command or a test, never "make sure X works". Add `Depends on #N` when another open issue edits the same files, and don't run two tickets that edit the same file in parallel.
- Label it `complexity: M|L` plus an `area:` label. Don't write a criterion the code can only satisfy vacuously (for example "test that a constant equals itself").
