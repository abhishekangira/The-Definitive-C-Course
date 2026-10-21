---
name: add-exercise
description: Add or change a course exercise (ct write, fb fix-a-bug, pa Parsons, lt local) or one of its variants under content/modules/*/exercises/, including generating tests.json from cases.yaml. Use when creating, editing or debugging an exercise folder.
---

# Add an exercise

Read the Exercises part of `content/AGENTS.md` and `tools/exercises/README.md` first. Expected outputs are never typed by hand: they come from running the reference solution.

1. **Create the folder** `content/modules/<module>/exercises/<id>/` with `exercise.yaml`, `starter.c` and `solution.c`. `exercise.yaml` needs `id kind title prompt runsIn hints variants` and `file`; `id` equals the folder name (which must be unique across all modules, because the app keys exercises by it: a new module prefixes its folders, for example `m03-gdb-hunt`) and `file` equals the first source in `tests.json`. Give exactly three hints: nudge, concept, partial code.
2. **Write the tests.**
   - stdin/args/stdout/exit tests: write `cases.yaml` (`cases: [{name, stdin?, args?, hint?}]`) and run `npm run exercises:expect -- --only <id>`. It writes `tests.json` from the reference solution and rejects a solution that warns, trips ASan or UBSan, or times out.
   - Unit, `make` and `scan` tests are written by hand. For `scan`, read "Operator-restricted exercises" in `tools/exercises/README.md` first.
   - Parsons (`pa`): `solution.c` is the canonical order, one block per line; see "Parsons exercises" in `tools/exercises/README.md`.
3. **Variants** are folders of their own, `variants/<n>/`, with every file they need: a variant inherits nothing from its parent. List each in the parent's `variants` (quote numbers: `'1'`).
4. **Use it** somewhere in the same module: `<Exercise id="<id>" />` in a lesson, the module's `problemSet` or `coreExercises` in `module.yaml`, or a quiz item. A core exercise without a variant gets a lint warning.
5. **Check it:**
   - `npm run verify:exercises -- --only <id>` (the solution passes, the starter fails, variants too)
   - `npm run exercises:expect -- --check` (the committed `tests.json` is current)
   - `npm run lint:content -- --strict`
   - if a lesson, the problem set, a project or a quiz uses it (the e2e clicks through all of them): `npm run build`, then `E2E_MODULE=<mNN> npm run e2e`
