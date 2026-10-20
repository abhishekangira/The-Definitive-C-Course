# Decision records

One file per decision that the code alone does not explain: what was decided, the options, the evidence, and what follows from it. Read the record before changing what it covers, so a settled question is not reopened without new evidence.

- Name them `NNNN-short-title.md`, numbered in order.
- Don't rewrite an accepted record. To change a decision, write a new record that says which one it replaces, and change only the old record's status line to `Superseded by NNNN`.
- Changing a decision is on the root `AGENTS.md` **Ask first** list.
- Decisions made before this folder existed are in `PLAN.md` §0 and §12 and in the **Decisions** section of the root `AGENTS.md`.

| Record | Decision |
|---|---|
| [0001](0001-agent-docs-layout.md) | Agent notes: a short root `AGENTS.md`, notes per area, skills and these records; no `CLAUDE.md` |
| [0002](0002-e2e-workers.md) | Playwright e2e runs on 2 workers in CI and 3 locally |

Template:

```
# NNNN: Title

Status: Accepted (YYYY-MM-DD, PR #N)

## Context
## Decision
## Evidence
## Consequences
```
