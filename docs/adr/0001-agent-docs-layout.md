# 0001: Agent notes live next to the code, with no CLAUDE.md

Status: Accepted (2026-10-19)

## Context
Coding agents from several tools and models work on this repo. All of their instructions were in one root `AGENTS.md` (imported by a one-line `CLAUDE.md`), which every session loads in full. It had grown to 7,115 words. 3,035 of them were "Pitfalls we already hit", mostly about one folder each, so a content-only ticket also loaded the details of the toolchain cache and the streak tests. One fact was written twice (how local-task codes are counted), and several bullets repeated comments that were already in the code (`playwright.config.ts`, `vite.config.ts`, `tools/verify/pty_run.py`).

## Decision
- **Root `AGENTS.md`:** only what applies to every change, an **Ask first** list, and a table of where each area's notes are. `tools/docs/agents-docs.test.ts` caps its length.
- **One area's notes:** in that area's `AGENTS.md`, or in its `README.md` when it already has one. Every `AGENTS.md` is listed in the root table (the same test checks it), because not every tool loads nested files.
- **Procedures:** skills in `.agents/skills/<name>/SKILL.md`, each linked from `.claude/skills/<name>`.
- **Decisions and their evidence:** records in `docs/adr/`.
- **A trap in one function:** a comment at that code.
- **No `CLAUDE.md` or `CLAUDE.local.md` anywhere** (the test fails if one appears). The owner uses the latest Claude Code, which reads `AGENTS.md` itself.

## Evidence
Claude Code 2.1.303, `claude -p` in throwaway git repositories, one run each (2026-10-19). Each instruction file named a codeword; the table shows which codewords Claude reported.

| Files | Codewords reported |
|---|---|
| `AGENTS.md` | root, at start |
| `AGENTS.md`, `sub/AGENTS.md`, after reading `sub/data.txt` | root and `sub` |
| `CLAUDE.md` (`@AGENTS.md`), `AGENTS.md`, `sub/AGENTS.md`, after reading `sub/data.txt` | root only |
| `AGENTS.md`, `other/CLAUDE.md` | root, at start |
| `AGENTS.md`, `CLAUDE.local.md` | none |

The CLI's own settings text describes its default `instructionFiles` mode as: "a project with no CLAUDE.md of its own gets its AGENTS.md files instead, loaded exactly where and how CLAUDE.md would be." So with the old one-line `CLAUDE.md`, a nested `AGENTS.md` would never have reached Claude Code.

Other tools differ. The AGENTS.md convention says the nearest file wins. Codex is documented to read the files from the repository root down to the directory it was started in, so an agent started at the root sees a nested file only if the root file sends it there (not tested here). That is why the root table exists.

## Consequences
- A Claude Code version that does not know `AGENTS.md` reads no project instructions at all. Use a current version.
- Personal notes go in `~/.claude/CLAUDE.md`; a `CLAUDE.local.md` in the checkout silently turns every `AGENTS.md` off.
- Options not taken:
  - Keep `CLAUDE.md` and add a one-line `CLAUDE.md` beside every nested `AGENTS.md`: works on old versions, but doubles the files.
  - Set `"instructionFiles": "claude-md-and-agents-md"` in `.claude/settings.json`: needs a recent version anyway.
  - A wiki or a docs tree away from the code: not changed in the same PR as the code, and no tool loads it by itself.
