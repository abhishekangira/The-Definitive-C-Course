Adversarial review of PLAN.md §5–§9 (pedagogy, ordering, realism). No files were edited. All test files are in /tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/review/. Items are ordered by severity.

**A. Bugs that break gates or verification**

1. **§2.3 "Exercises from M5 add `-include leakcheck.h`", P5 gate, §2.4 C harness.** The registry in `leakcheck.h` is `static lc_blk *lc_head`, so each translation unit gets its own copy. P5's unit tests link the learner's file with a separate harness file.
   - Verified with gcc 13 on prototypes/leakcheck/leakcheck.h:
     - A block allocated in lib.c and freed in harness.c, both built with `-include`, prints "INVALID FREE … harness.c:3" and "LEAK: 3 bytes allocated at lib.c:2".
     - If the harness is built without the header, the run aborts with `munmap_chunk(): invalid pointer` (exit 134).
     - Passing `free` as a destructor pointer (the M8.1 pattern) skips the function-like macro and segfaults (exit 139).
     - A struct member named `free` (`a.free(p)`) fails to compile.
   - Why it matters: a correct P5 solution fails its gate, or crashes.
   - Fix:
     - Keep one registry in a separately linked `leakcheck.c`, with `extern` declarations in the header.
     - Build the harness with the same header.
     - Map names with object-like macros (`#define free lc_free_fn`) to real functions, so `free` used as a value and `->free` members still work.
     - Check the canaries of leaked blocks at exit too.

2. **§5 defines CT as running "in the browser", but §6 tags native-only work as CT:** 11.3 (`ar`, `-shared`, `dlopen`), 11.5 (Makefile), 13.4 (pipes) and the M13 checkpoint's "2 CT (`run_pipeline`)". `verify:exercises` checks CT items with the browser toolchain.
   - Verified with @yowasp/clang 22 in Node: `pipe` and `dup2` are undeclared, `<sys/wait.h>` is not found, and `dlopen` is an undefined symbol at link time.
   - Fix: retag these as LT (native work with a token), or give in-browser substitutes.

3. **§2.5 checkpoint rule vs the checkpoint lists in §6.** The rule requires 8–12 items including a write-code item, a fix-a-bug (FB) item, an MD or SP item, a compiler-message (CE) item and a transfer item.
   - Gaps:
     - M2: no FB, no CE
     - M4, M5, M8, M12: no CE
     - M6: no CT, and FB only if LT counts as one
     - M9: only 5 items and no transfer item
     - M10: no FB, no CT
     - M11: no CT, no FB
     - M13: no FB
   - Fix: rebalance each checkpoint list, or relax the rule.

4. **§6 Rhythm says a lesson is "30–60 minutes of 3–6 cards", and §2.2 says content cards alternate with interaction cards.** That allows at most about 3 interactions and 750 words per lesson.
   - The tables break this:
     - 1.6 lists CE×5, PR and Y3 (with at least 2 pause questions), so 9 or more interaction cards.
     - 2.3 lists PR, NP, CE, FB and A3.
     - 10.6 and 13.6 list 5–7 concepts each, which won't fit in the word budget.
   - Fix: drop the card cap (say 6–14 cards) and let content-lint enforce cadence.

5. **Video time is not budgeted.** Per-module lesson minutes add up exactly to judged.md's "lessons X h", so about 175 minutes of CS50 video sits on top of them.
   - Computed segment lengths and the lessons they sit in:

     | Video | Length | Lesson | What else the lesson holds |
     |---|---|---|---|
     | Y3 | 17:15 | 1.6 (35m) | CE×5, PR |
     | Y9 | 12:40 | 6.5 (30m) | CE |
     | Y13 | 23:00 | 9.2 (45m) | A14, CT, SP |
     | Y11 | 21:30 | 8.3 (60m) | A12, MD, SP, FB |
     | Y12 | 16:00 | 8.5 (50m) | SP, PA, a BST CT |
     | Y10 | 16:25 | 7.3 (40m) | CT `cp`, FB |
     | Y5 | 12:46 | 4.4 (50m) | A6, CT `merge_sort`, PR |

   - Segments of 16–23 minutes also go against "embed only when a specific segment teaches something better than the app": Y12 and Y13 repeat V4, V5 and A14.
   - Fix: cut each video to an excerpt of 6 minutes or less, or add the video minutes to the hours.

6. **P2 Credit "identical output on wasm32 and native" (§6 M2).** The browser runner has no native compiler and there is no backend, so this cannot be checked for learner code.
   - Fix: say the learner check is wasm32-only. That still catches `long`, because `long` is 4 bytes there and 16-digit numbers overflow. Only the reference solution runs natively.

**B. Ordering and dependency bugs**

7. **5.5 "Code, static, stack, heap" comes before 5.6 `malloc`.** 5.5 asks learners to place heap objects and predict the native vs wasm32 address order before `malloc` is taught. Fix: swap 5.5 and 5.6, as CS50 L4 does.

8. **3.5 "`strtol` vs `atoi`" and P3 "non-numeric k rejected".** Catching junk input with `strtol` needs `char *end; strtol(s,&end,10); if(*end)`, which uses `&`, `char **` and dereferencing (M5). With a NULL end pointer it is no better than `atoi`. Fix: validate with an `isdigit` loop in M3 and revisit `strtol`'s end pointer in 5.3 as the out-parameter example.

9. **M2 problem set `hexcolor` "parse … colours".** Parsing `#RRGGBB` needs string indexing (M3) or `scanf("%x",&v)` / `strtol` (M5). Fix: add a learnc.h `get_hex()` or have the starter do the parsing, leaving the bitwise work; or move hexcolor to M3.

10. **2.6 "UTF-8 vs UTF-16 lengths".** Counting the bytes of "é" or 👍🏽 needs string literals as arrays and `strlen` (3.2). Fix: show bytes in V2 only in M2 and move the `strlen` prediction to 3.2.

11. **1.5 CT Hello-It's-Me "(empty name re-prompts)" vs §4.3, where `get_line` "re-prompts on bad input".** Either the helper already rejects empty input, so the test checks the helper and not the learner, or the learner needs `name[0]=='\0'`, which is taught in M3. Fix: decide which, and document it.

12. **4.4 CT `merge_sort` "merge buffer".** There is no `malloc` until 5.6, VLAs are never taught, and large VLAs overflow the stack. Fix: use `merge_sort(int a[], int tmp[], int n)` with a scratch buffer the caller provides.

13. **7.5 "heap 2D arrays".** The standard idiom (judged.md: `RGBTRIPLE (*img)[w] = calloc(h, sizeof *img)`) is a pointer to a VLA type, which is never taught and is optional in C17. Fix: teach `T (*p)[w]` explicitly with an MD card, or use a flat buffer indexed `img[y*w+x]`.

14. **P5 `get_line(FILE*)`.** `FILE*`, `getc` and EOF are only taught in 7.3. The function also changes signature (prompt → `FILE*`) and ownership (the caller must now free), so it does not "replace the helper" for earlier programs. Fix: test on stdin only, add a `getc`/EOF card in M5, and present it as a new function that hands ownership to the caller.

15. **P13 "Ctrl-C kills the child, not the shell" vs 13.5, which has only a PR, and §10, which defers signals.** The shell needs `SIG_IGN` in the parent and `SIG_DFL` in the child before exec. A runner with no tty also needs `setpgid` plus `kill(-pgid,SIGINT)` to simulate Ctrl-C. Fix: add a CT or LT in 13.5 and specify how the runner sends Ctrl-C.

16. **Which Sort (M4).** The mystery binaries read data files, and file I/O comes in M7. Fix: state that the mystery binaries are pre-built wasm that read files preloaded into the WASI filesystem, and that the learner's own sorts use generated in-memory data.

**C. Never-passive rule and internal contradictions**

17. **§2.4 fence key `run` lets code run without a prediction.** This goes against the spec's predict-before-run rule, and content-lint does not check it. Fix: make `predict` the default for every `id` fence in lesson prose, and allow `run` only inside CT/FB editors.

18. **§5 says "UB is never a prediction answer", but 1.6 has a PR [both] on a missing printf argument.**
   - Verified: gcc and clang native builds print different garbage every run (`-1258497672`, `-581864344`, …), and wasm prints `score 0`. There is no stable answer to store.
   - 5.2, 5.5, 5.7 and A9 have the same rule conflict, though their crash / no-crash outcomes are deterministic.
   - Fix: allow UB predictions only as deterministic observables (crashes or not, or what UBSan reports) marked `expect=ub`, and rewrite 1.6's item.

19. **§6 M1 Stage 2 note claims "SP via the 1.4 trace", but 1.4 lists only PR, MD and CT.** "Every interaction type" also overstates it: §5 defines 12 codes. Fix: add SP to 1.4 and say "every spec-required type".

20. **§4.5 and §9 pause points.**
    - A plain `embed?start=&end=` iframe cannot pause at set times. It needs the IFrame Player API (`enablejsapi=1` and polling), and the click-to-load facade must load it.
    - §9's L5 times are already shifted by −1 h (judged.md marks them "corrected by −1 h"), yet §1.4 and §9 say they will be "re-timed" later, so a later session could subtract the hour twice.
    - Fix: specify the API design, and mark the L5 times "already corrected; re-verify only".

21. **§9 "Why it earns its place" is "—" for Y4, Y7, Y8, Y9, Y12 and Y13, and Y2's reason is undecided.** The spec requires a reason for every video.
    - Y8 does not fit lesson 6.3. Verified from CS50's lecture2.srt: at 00:26:12 David says "Is that called debug 50 … start an industry standard debugger", and at 00:27:03 he types "debug 50 space buggy". So Y8 shows CS50's debug50 VS Code wrapper, while 6.3 teaches the lldb/gdb command line.
    - Y13 (01:38–02:01) runs from hashing through tries but sits in 9.2.
    - Fix: write a reason for each video, replace or reframe Y8, and split Y13 between 9.1 and 9.4.

22. **Time breakdowns are missing.** judged.md has per-module "Time: lessons · pset · project · variants · quiz" lines, which PLAN.md dropped, so later sessions cannot check budgets. Fix: copy them back in, with the video minutes added.

**D. JS analogies that are wrong or have no breakdown**

23. **M4 "Maximum call stack size exceeded … the limit is bytes, not frames".** V8's limit is also in bytes.
    - Verified in Node 22: maximum depth is 9,637 with a small frame and 3,796 with 20 locals. §1.2 itself says "6–15k frames depending on frame size".
    - Fix the breakdown: JS throws a catchable RangeError with a message; C gets SIGSEGV with no message, on a default 8 MiB main stack.

24. **M13 "`fs.openSync` fd … Exactly the same numbers".**
    - Verified in Node 22 on Linux: the first `openSync` returned **20**, because libuv already holds fds. A C program's first `open` returns 3. In Node on native Windows, fds are CRT emulations.
    - Fix the breakdown to say this.

25. **M13 "WASI … Literally a syscall interface" gives no breakdown.** WASI calls are imported JS functions in the same process: no trap, no privilege switch. Fix: say that.

26. **M12 "TypedArray vs array of objects ↔ SoA vs AoS: Same lesson".** A JS array of objects is an array of pointers, not AoS. Fix the mapping:
    - array of objects ≈ array of struct pointers
    - parallel TypedArrays ≈ SoA
    - one interleaved TypedArray ≈ AoS

27. **M8 "Event loop … Rebuilt from your own queues" gives no breakdown.**
    - Verified in Node 22: `setTimeout(A,1); setTimeout(B,0)` prints A then B, because Node clamps 0 ms to 1 ms. A naive (time, seq) BST prints B first.
    - Fix: P8 must clamp delays below 1 to 1 and leave out nextTick, setImmediate and I/O phases; say so in the breakdown.

28. **M3 "`process.argv` … argv[0] is the program".** Node's argv[0] is a program too. The real difference, that user arguments start at index 2 in Node and index 1 in C, was dropped from judged.md. Fix: restore it.

29. **M5 "`WebAssembly.Memory` … Exactly true in wasm32" overclaims.** Code, return addresses and locals whose address is never taken are not in linear memory, and function pointers are table indices.
    - Verified with yowasp: `(void*)main` prints `0x1` (global `0x10978`, local `0xfff8`, heap `0x11130`).
    - Fix the breakdown.

30. **M13 "Web Worker ↔ process".** A Worker is a thread inside the same OS process, not a process. Fix the breakdown.

31. **M12 "…64-byte lines".** Apple Silicon reports `hw.cachelinesize` = 128 (web search, sources below), and its pages are 16 KiB, which matters for 13.6 address translation. Fix: platform-tag cache line and page sizes, and have doctor.sh print both.

**E. Gaps against the success criteria**

32. **SC5 tries.** 9.4 has only MD and PR, P9 makes the trie optional, and the default capstone track has no trie. A default-track graduate never implements a trie, yet the §6.1 matrix marks SC5 as assessed in M9. The matrix also disagrees with several per-module SC lines (M1, M4, M8, M9, M11). Fix: require a trie CT with leak checking in 9.4.

33. **SC10 "what the OS does on their behalf".** Scheduling, timer interrupts, context switches and limited direct execution appear nowhere; grep finds no "schedul" or "context switch". Fix: add a card and a PR to 13.1 or 13.3, citing OSTEP ch. 6 "Mechanism: Limited Direct Execution" inside the existing OSTEP resource.

34. **SC2 "where any variable lives".** 5.5 does not cover read-only data (string literals, const globals), `.data` vs `.bss`, static local variables (static storage duration is never taught; 6.6 and 11.2 cover only linkage), or register-only locals.
    - Verified: gcc `-pedantic` warns "ISO C forbids conversion of function pointer to object pointer type" on `(void*)main` and clang 18 does not. A code-address sample would fail §3.1's `-Werror` and gcc/clang agreement checks.
    - V3 traces come from native x86-64 gdb, so the M1/M4/M5 diagrams show 8-byte pointers and native region order, unlike the learner's wasm32 runs.
    - Fix:
      - List text, rodata, data, bss, heap and stack in 5.5.
      - Show code-region addresses only from stored output or `nm`.
      - Label every trace "x86-64 Linux".

35. **SC6: quicksort is absent.** Fix: add partition and quicksort to 4.4 or as a CT, linking it to `qsort` in 8.1.

36. **SC4 on macOS.** Mac learners never run Valgrind or gdb themselves; 6.5 only shows stored reports. Fix: offer an optional Linux container or Codespaces route in 6.5, which also helps learners who cannot install WSL.

**F. Project realism and capstone specification**

37. **P10 "per-learner seeded `phases.o`".** There is no backend, and the browser clang has only wasm backends (§1.2), so per-learner objects must come from a pre-built pool. Pool size and how the token maps to a variant are unspecified. Intel Macs (x86-64 Mach-O) are missing from the targets, and the M10 intro says "Mac learners see arm64".
    - 4.5 h (judged.md) for five bomb-lab-style phases, including jump table, recursion and linked list, plus two write-C items, is low for assembly beginners.
    - Fix: specify the pool, add `x86_64-apple-macos`, and budget 6–8 h or cut to 3 phases.

38. **P12 part B: "miss counts measured by the learner's own simulator".** That needs an address trace of the learner's transpose. CS:APP uses valgrind lackey, which is unavailable on Apple Silicon, and PLAN does not say how traces are made. Thresholds are unspecified, and judged.md says its cachelab parameters are "from memory".
    - Fix: provide an `A(i,j)` access macro that logs addresses, publish thresholds calibrated against a simple blocked solution, and budget 8–10 h or make 64×64 a distinction.

39. **P9 "at least k× faster": k is never defined.** Track B's "≥2×" could end up equal to it. Fix: set k (for example 2×, median of 5 runs at `-O2`) and make Track B stricter.

40. **9.5 and 9.6 use POSIX** (`clock_gettime`, `getrusage`, `strcasecmp`) outside the OS modules, which the spec does not allow. Fix: use C17 `timespec_get` in a provided harness, and have learners write their own case-insensitive compare.

41. **Capstone week 4 integration: the mechanism is unspecified.** judged.md's `-include mm_shim.h` hits the same failures as item 1 (`free` used as a value, struct members named `free`). It also breaks when the program frees memory that libc allocated (`getline`, `strdup`).
    - The "≥70% utilisation" and "≥0.25× libc" thresholds lost judged.md's "calibrated against a staff allocator". glibc and macOS libmalloc differ, and traces of small blocks such as Speller words cannot reach 70% with 16-byte alignment plus boundary tags.
    - Fix:
      - The shim's `free` forwards any pointer outside `mem_heap_lo`/`mem_heap_hi` to libc.
      - Set per-trace thresholds relative to a reference allocator compiled on the learner's machine.

42. **M10 resources are x86-64 only** (CS:APP §3.1–3.7, 15-213 L6/L7), while Mac learners work in arm64 and the checkpoint uses "the learner's ISA". Fix: swap one of them for an arm64 reading, with the chapter verified when M10 is built.

**Checks that passed:**
- Tideman's prerequisites (2D arrays 3.6, recursion 4.3, structs 4.5) all come before P4.
- Endianness in code (5.4) comes after pointers, and struct padding (7.2) after structs.
- `qsort` and function pointers (8.1) come before any use.
- No Make is needed before M6.
- Resources stay within 1–2 per module.
- `DataView` defaulting to big-endian, V8 sort being stable, and Fiber's `child`/`sibling`/`return` fields (judged.md) are correct.

Sources for the Apple Silicon cache-line size:
- [More M1 fun: Hardware Information](https://cpufun.substack.com/p/more-m1-fun-hardware-information)
- [Go x/sys: fix cacheLineSize for arm64 darwin](https://go.googlesource.com/sys/+/20c2bfdbfe249b02ea905477d7cff52673dadfa2)
- [MacRumors thread on M-series cache sysctl](https://forums.macrumors.com/threads/request-for-some-system-information-about-cpu-caches.2478481/)