---
name: review-and-merge-pr
description: Review a pull request of this repo in a separate worktree, check that its AGENTS.md and README notes are still true, check it against main before merging, retarget stacked PRs and clean up merged branches. Use when the lead session reviews, merges or retargets a PR, or deletes a merged ticket branch.
---

# Review and merge a pull request

Everything here was verified in the cloud container. The PR rules themselves are in the root `AGENTS.md`.

## Review it locally without touching your working tree
1. `git fetch origin pull/N/head && git update-ref refs/review/prN FETCH_HEAD`
2. `git worktree add --detach <dir> refs/review/prN`
3. `ln -sfn <repo>/node_modules <dir>/node_modules`
4. `mkdir -p <dir>/public && ln -sfn <repo>/public/toolchain <dir>/public/toolchain`
5. `cp <repo>/src/generated/toolchain-version.json <dir>/src/generated/`
6. Run the gates there with a distinct port (`E2E_PORT=4181`) and `E2E_RUN_TIMEOUT=120000`.
7. Remove the worktree afterwards: `git worktree remove --force <dir>`.

Use `ln -sfn`, not `ln -s`: onto an existing link, plain `ln -s` creates a link *inside* the target, which once put `public/toolchain/toolchain` (pointing at itself) into the shared directory and broke every build with `ELOOP`. If you see that, delete just that link (`rm public/toolchain/toolchain`, no trailing slash).

A worktree whose `node_modules` is a symlink to another checkout must `rm node_modules && npm ci` before `npm install`, or it edits the other checkout.

## Check the notes
Reviewers check that the notes are still true (the root `AGENTS.md`, "Reviewers check the notes too"). A test can tell that a note exists, not that it is right, so this is read by hand.
1. List the folders the diff touches: `git diff --name-only origin/main...refs/review/prN`.
2. For each, read its `AGENTS.md` or README (the root table "Where to find what" names it), and the root `AGENTS.md`.
3. On every PR, however small, also read the root `README.md` (what the app is, how to run it, where to read next, the licence).
4. Ask whether the change made a statement in any of them untrue (a path, command, rule or number), and whether it taught a lesson that is not written down.
5. Read the **Notes:** line of the PR description. If it is empty, says "none", or does not say the root `README.md` was checked, check that yourself.
6. A note or README the change made untrue blocks the merge, like a missing test. An unwritten lesson is a nit.

## GitHub API details
Use REST (`gh api repos/<owner>/<repo>/...`). In list endpoints (`pulls?state=open`) `additions`, `deletions`, `changed_files` and `mergeable` come back `null`: read a single PR (`pulls/N`), and retry `mergeable` after a few seconds (it stays `null` while GitHub computes it).

## Before merging
- **Parallel PRs that edit the same file conflict** (for example `tools/mdx/remark-course.ts`). Detect it before merging with `git merge-tree --write-tree <main> <pr-head>` (prints `CONFLICT` lines; GitHub's `mergeable` can stay `null` for minutes), merge one, then merge `main` into the other (no force-push) and fix the conflict.
- **Stacked PRs.** PRs are squash-merged, so a PR whose base is another PR's branch no longer matches `main` once that PR merges. Retarget it (`PATCH /pulls/N` with `base=main`), merge `main` in and resolve conflicts before asking for review.

## After merging
- Re-check the state of every issue the PR names: GitHub closes issues on negated keywords too ("Do not close #1" closed #1).
- **Branches can't be deleted from the agent sandbox.** The session's GitHub proxy answers `DELETE /git/refs/heads/<name>` and `git push --delete` with 403 (a policy denial: don't retry). Delete merged `ticket/*` branches in the web UI (Branches page) or from a normal clone with `git push origin --delete <name>`, and only after checking that the PR merged at exactly the branch tip.
