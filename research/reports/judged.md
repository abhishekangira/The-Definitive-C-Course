# Judge report: scoring three C-course outlines and one synthesized final outline

Learner-first wins with 69/80. CS50-parity is close behind at 65 and low-level-depth scores 56. The final outline below starts from learner-first and grafts in the strongest parts of the other two. It has 13 modules plus a capstone: **195 h ≈ 39 weeks at 5 h/week**. CS50x C parity is reached at **week 23.5**.

## 0. What I verified and what I only read

All my files are under `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/judge/`.

### Verified by running it in this session

**1. The CS50 Lecture 5 caption file runs one hour ahead of the video.**
- `lecture5.srt` (from `cdn.cs50.net/2025/fall/lectures/5/lang/en/`) starts at `01:00:44,541` and ends at `03:03:16`.
- The real video length comes from the MP4's duration header. I fetched the last 8 MB of the file with `curl -r -8000000` and parsed it with `mvhd.py`:

  | Lecture | MP4 length | Last caption | Offset? |
  |---|---|---|---|
  | L5 | 7429.8 s = **2:03:49** | 03:03:16 | **yes, +1 h** |
  | L1 | 2:30:17 | 02:29:42 | no |
  | L4 | 2:19:54 | 02:19:21 | no |

- So the cs50-parity and low-level drafts give **wrong L5 timestamps**. Low-level's "02:53:50" for tries is past the end of the video.
- Learner-first noticed the offset and corrected for it.
- Corrected first mentions in L5: "linked list" 00:34:19 (the topic starts about 00:33:30), "binary search tree" 01:23:03 ("And so I give you trees" at about 01:22), "hash function" 01:40:32, "hash table" 01:45:25, "trie" 01:53:52.
- I also checked first mentions in the other captions:
  - L4: hexadecimal 00:07:36, Valgrind 01:14:07, Binky 01:27:41, heap 01:40:40.
  - L3: merge sort 01:46:12.
  - L2: debugger 00:26:17, assembling 00:42:32, preprocessing 00:50:07, null character 01:38:42.
  - L1: overflow 02:19:42, Boeing 02:22:14, imprecision 02:27:44.
- Caveat: YouTube is unreachable from here. These times are for the CDN recording that the captions belong to.

**2. CS50x 2026 problem sets** (curl of `/x/psets/1..5/`):

| Pset | Problems |
|---|---|
| PS2 | Scrabble; Readability; Caesar **or** Substitution. **No Wordle.** |
| PS3 | Sort; Plurality; Runoff **or** Tideman ("optional but challenging") |
| PS4 | Volume; Filter less **or** more; Recover |
| PS5 | Inheritance; Speller |

- The Cash spec takes change "in cents" and asks for "an int greater than 0". **Learner-first's Cash tests ("0.01, 0.41, 4.20 in dollars") follow the old spec and are wrong for 2026.**

**3. Book and lecture chapter numbers, fetched from primary sources:**
- **Beej's Guide to C v0.11.0** (© Sep 26 2026). These chapters match: 2 Hello, World!; 3 Variables and Statements; 4 Functions; 5 Pointers—Cower In Fear!; 6 Arrays; 7 Strings; 8 Structs; 9 File Input/Output; 11 Pointers II: Arithmetic; 12 Manual Memory Allocation; 17 Multifile Projects; 18 The Outside Environment; 19 The C Preprocessor; 20 structs II; 24 Bitwise Operations; 26 Locale and Internationalization; 27 Unicode, Wide Characters, and All That; 37 Fixed Width Integer Types; 39 Multithreading; 40 Atomics. All Beej citations in the three drafts are correct.
- **OSTEP v1.10**: 4 Processes; 5 Process API; 13 Address Spaces; 14 Memory API; 17 Free Space Management; 18 Introduction to Paging; 19 Translation Lookaside Buffers; 20–23 (VM); 26 Concurrency and Threads; 32 Concurrency Bugs; 33 Event-based Concurrency; 39 Files and Directories; 40–42 (file systems). Correct in all drafts.
- **CS:APP 3e** (from the publisher's preface PDF):
  - §2.1 Information Storage, p. 34; §2.4 Floating Point, p. 108
  - §3.4 Accessing Information, p. 179; §3.7 Procedures, p. 238; §3.8 Array Allocation and Access, p. 255; §3.9.3 Data Alignment, p. 273
  - §3.10.2 Using the gdb Debugger, p. 279; §3.10.3 Out-of-Bounds Memory References and Buffer Overflow, p. 279; §3.10.4 Thwarting Buffer Overflow Attacks, p. 284; §3.11 Floating-Point Code, p. 293
  - §6.2 Locality, p. 604; §6.4 Cache Memories, p. 614; §6.5 Writing Cache-Friendly Code, p. 633; §6.6 Putting It Together: The Impact of Caches on Program Performance, p. 639
  - §7.1 Compiler Drivers, p. 671; §7.10 Dynamic Linking with Shared Libraries, p. 698; §7.12 Position-Independent Code, p. 704; §7.13 Library Interpositioning, p. 707
  - §8.4 Process Control, p. 738; §8.5 Signals, p. 756
  - §9.9 Dynamic Memory Allocation, p. 839; §9.9.12 Putting It Together: Implementing a Simple Allocator, p. 854; §9.9.14 Segregated Free Lists, p. 863; §9.10 Garbage Collection, p. 865; §9.11 Common Memory-Related Bugs in C Programs, p. 870
- **K&R 2e** (Cisco Press sample PDF): §1.10, p. 31; §2.7 Type Conversions, p. 42; §4.3 External Variables, p. 73; §4.5 Header Files, p. 81; §4.6 Static Variables, p. 83; §4.10 Recursion, p. 86; §5.6, p. 107; §5.10 Command-line Arguments, p. 114; §5.11 Pointers to Functions, p. 118; §6.4, p. 136; §6.5 Self-referential Structures, p. 139; §6.6 Table Lookup, p. 143; §7.5 File Access, p. 160; §7.6 Error Handling—Stderr and Exit, p. 163; §8.7 Example—A Storage Allocator, p. 185.
- **GNU Make manual 4.4.1** (updated Feb 26 2023): ch. 2 An Introduction to Makefiles; ch. 4 Writing Rules; §4.6 Phony Targets; §4.14 Generating Prerequisites Automatically.
- **CMU 15-213 Fall 2015 schedule**: Lecture 6 "Machine Prog: Control" (reading 3.6); Lecture 7 "Machine Prog: Procedures" (3.7); Lecture 11 "The Memory Hierarchy" (6.1–6.3); Lecture 12 "Cache Memories" (6.4–6.7; cachelab released then); Lecture 13 "Linking" (7); Lecture 14 "ECF: Exceptions & Processes" (8.1–8.4).
- **Erickson, *Algorithms***: the chapter files are `00-intro`, `01-recursion` … `06-dfs`, so ch. 1 "Recursion" and ch. 6 "Depth-First Search" are correct.
- **Nand2Tetris**: Project 4 Machine Language, Project 5 Computer Architecture.
- **CLRS 4e** (WebSearch, two listings agree): ch. 2 "Getting Started", p. 17; ch. 3 "Characterizing Running Times", p. 49.
- **Effective C 2e**: nostarch.com returned a Cloudflare wall to curl and WebFetch could not resolve it. I cross-checked against the No Starch detailed-TOC text that the low-level draft saved, plus a WebSearch snippet:
  - Chapters: 1 Getting Started; 2 Objects, Functions, and Types; 3 Arithmetic Types, p. 47; 5 Control Flow, p. 97; 6 Dynamically Allocated Memory; 7 Characters and Strings, p. 137; 8 Input/Output, p. 167 ("Endian", p. 191); 9 Preprocessor, p. 195; 10 Program Structure, p. 213 ("Linkage", p. 219); 11 Debugging, Testing, and Analysis, p. 229 ("AddressSanitizer", p. 253).
  - It covers **C23**; ISBN 9781718504127.

**4. New: a browser-side memory checker.** The wasm toolchain cannot link ASan (two drafts confirmed this). `leakcheck.h` is an MIT-style header injected with `-include`; full text in Appendix A.
- With `@yowasp/clang@22.0.0-git20542-10` targeting wasm32-wasi under Node 22 `node:wasi`, **and** natively with gcc 13.3 plus `-fsanitize=undefined`, it reported the same errors with file and line.
- Test program 1 has `malloc(strlen(s))` missing the +1, plus a leak:
  ```
  HEAP OVERFLOW: wrote past end of 5-byte block from buggy.c:5 (detected at buggy.c:13)
  LEAK: 5 bytes allocated at buggy.c:5 never freed
  leakcheck: 1 block(s), 5 byte(s) leaked; 1 heap error(s)
  ```
- Test program 2 has a double free and a calloc leak. It printed `INVALID FREE: 0x113a0 at buggy2.c:9` and `LEAK: 12 bytes … buggy2.c:10`. Payloads are 16-byte aligned (`aligned16=1`) on both targets.
- There are no warnings under `-std=c17 -Wall -Wextra -pedantic` with either compiler. The wasm output is 30,437 B.
- **Limits:** it catches leaks, overflow into the 8-byte canary (checked at `free` time), double or invalid `free`, and invalid `realloc`. It **does not** catch out-of-bounds reads, use-after-free, or stack errors. ASan is still needed, which keeps the reason for going native in M6.

### Read in the drafts and used, but not re-run by me
These come from the drafts' own verification logs:
- wasm32 sizes: `long`, pointers and `size_t` are 4 bytes.
- In the browser, a NULL read prints 0, writing a string literal prints `Jello`, and a heap overflow is silent.
- `-fsanitize=undefined -fsanitize-trap=undefined` works in the browser toolchain.
- The default wasm stack is 64 KiB. `-Wl,-z,stack-size=8388608` fixes deep recursion.
- wasm layout puts the stack *below* globals and heap. Native x86-64 orders code < globals < heap < stack.
- printf+fork duplicates output when piped.
- Row-major vs column-major speed ratio: 17–20× native, 4.6–7.1× wasm, 4.3× in JS.
- clang 18 in this container lacks the ASan runtime.
- A browser build pipeline (`-E/-S/-c/nm/link` errors) is feasible.
- `react-reconciler@0.31.0` FiberNode has `return`, `child` and `sibling` fields.

### Docs only (not verified here)
- Valgrind and gdb are unavailable on Apple Silicon; use `leaks --atExit` and lldb there.
- macOS Command Line Tools ship GNU Make 3.81.
- `perf` is limited on WSL2; `dtruss` needs SIP changes.
- CS:APP cachelab parameters (s=5, E=1, b=5; 32×32 and 64×64) are from the drafts' memory. The 15-213 schedule only confirms that cachelab exists.

---

## 1. Scores (1–10)

| Criterion | cs50-parity | low-level-depth | **learner-first** |
|---|---|---|---|
| Success-criteria coverage | 9 | 9 | 9 |
| CS50 parity | **10** | 7 | 8 |
| Ordering and dependencies | 6 | 5 | **8** |
| Time realism at 5 h/week | 6 | 5 | **7** |
| Fit for front-end engineers | 9 | 6 | **10** |
| Interaction design | 9 | 9 | **10** |
| Outside resources (accuracy) | 7 | 7 | **9** |
| Capstone rigor | **9** | 8 | 8 |
| **Total / 80** | **65** | **56** | **69 (winner)** |

### cs50-parity
- **Coverage 9.** Every success criterion has a primary module. Assembly is taught on both ISAs. The linking project includes an ABI test.
- **Parity 10.** It always requires the harder variant (Mario-more, Credit, Substitution, Tideman, all five filters). Speller++ needs two backends and must beat a baseline. Its spec details were checked against the real specs.
- **Ordering 6.**
  - Struct padding and `offsetof` (M3.5) come before structs (M5.3).
  - `qsort` comparators with function pointers and `const void*` (M5.6) come before pointers (M6).
  - The M1 helper `get_int(prompt, &out)` needs `&` in week 1.
  - The `memcpy` float-bits lesson (M3.4) comes before pointers.
- **Time 6.** A cachelab-equivalent (simulator plus blocked transpose) gets 4 h. Two-backend Speller plus benchmarking gets 6.5 h. Minishell plus three tools gets 7.5 h.
- **Front-end fit 9.** The `eventloop` project, CSS `#RRGGBB`, React lanes, and `Uint8ClampedArray` clamping vs `uint8_t` wrapping are excellent hooks.
- **Interaction 9.** Strict codes, the ≤250-word rule, UB never used as a prediction answer, and variants after solutions.
- **Resources 7.** K&R, Beej, OSTEP and CS:APP numbers are correct. **But both L5 segments are 1 h late.** Its CS:APP sub-titles are from memory, and one "resource" slot is a CS50 video.
- **Capstone 9.** A 25 h allocator with seven milestones, integrated into the learner's own Speller and eventloop.

### low-level-depth
- **Coverage 9.** Strongest on CPU and assembly (TinyCPU plus Defuse) and on the in-browser build pipeline.
- **Parity 7.** It keeps CS50's "one of" choices (Filter less **or** more, Runoff **or** Tideman, a single Speller backend). That makes it equal to CS50, not better. Its extras (bitlab, cachesim, SHA-256-checked Recover) are good.
- **Ordering 5.**
  - Big-O, search and sort (CS50 Week 3) are pushed to weeks 17–22.
  - Defuse phases use string compare and linked nodes before pointers (M7) and structs (M8).
  - `dlopen` and C↔JS calls appear in M5, before pointers.
  - Recursion runs on TinyCPU before recursion in C.
  - Pointers only arrive at week 14.
- **Time 5.** A datalab-like bitlab plus Credit gets 3.5 h. TinyCPU emulator plus four assembly programs gets 4 h. Speller plus cachesim gets 6.5 h. Filter, Recover and Volume together get 6.5 h. The allocator gets 20 h.
- **Front-end fit 6.** Good analogies, but eight weeks of machine-first material is a motivation risk, which the draft itself admits.
- **Interaction 9.** It adds a **completion token** so native work can gate progress in a backend-less app, a good idea.
- **Resources 7.** Its citations are the best (CS:APP page numbers, the 15-213 F15 lecture numbers and Erickson, all verified). It is marked down because the **L5 timestamps are 1 h late, one of them past the end of the video**.
- **Capstone 8.** Allocator plus Speller plus an `LD_PRELOAD` stretch goal, but 20 h is tight.

### learner-first
- **Coverage 9.** Every success criterion is introduced, developed and assessed. The source-to-process story is spread across M1, M6, M10 and M12 of that draft.
- **Parity 8.** Both Mario variants, both ciphers, Cash and Credit. But Tideman is optional, Filter less/more is ambiguous, and Speller has a single backend.
- **Ordering 8.** The local toolchain arrives exactly when the browser stops being enough (M6 of that draft, after pointers). Minor issues: an endianness byte-dump appears in M2, before arrays and pointers, and a `void*` mention comes before pointers.
- **Time 7.** Mostly realistic. Tight spots: the Media Lab (Volume, Filter, Recover) in 6 h, the shell in 5 h, and the allocator in 20 h with a 0.5× libc throughput bar.
- **Front-end fit 10.** CSS hex colours, React Fiber linked lists (verified), DOM trees, Web Worker vs process, the WASI syscall tracer, an in-browser BMP preview, and the planned moment where ASan exposes the M5 bugs.
- **Interaction 10.** The pipeline *enforces* the word budget, every checkpoint has a transfer item, outputs show in [both] panels, and a UB-trap guardrail mode is available.
- **Resources 9.** CLRS 4e, GNU Make §4.14, the CS:APP ch. 6 sections, OSTEP and Effective C are all verified. **It alone caught the L5 offset.** Small errors: the Cash spec, and an unverified "Modern C ch. 20 Threads".
- **Capstone 8.** Allocator plus Speller and shell integration plus a `mm_dump` feed into the stepper, and Track B. But 20 h is tight.

---

## 2. Synthesis: what came from where and what I fixed

**Base:** learner-first's order (browser, then pointers, then going native, then data structures, then under-the-hood topics), pacing rules, [both] panels, guardrail mode and analogy set.

**Grafted from cs50-parity:**
- The **harder-variant parity rule**: Tideman and all five filters are required.
- The data-structures material split into two modules.
- The **`eventloop` project**.
- Speller must beat a `bsearch` baseline (no staff-solution spoilers).
- Property tests (cipher round-trip, `libstr` randomized tests).
- A forbidden-symbol check with `nm`.
- Credit must give identical output on wasm32 and native.
- A synthetic, CC0-sourced Recover card.
- The licence guard: CS50 specs are CC BY-NC-SA and libcs50 is GPL-3.0.
- The **ABI-stability test** in Libify.
- Shell status 127 for a missing command.
- The cachesim project.
- A 25 h capstone with integration into the learner's earlier projects.
- `utf8` counting (👍🏽 = 8 bytes, 2 code points, 4 UTF-16 units).
- The swap, JPEG-carving and loader animations.

**Grafted from low-level-depth:**
- The completion token for native gates.
- A TinyCPU decode loop written in C, plus the V10 visualizer.
- Per-learner seeded Defuse phases that **the learner links themselves**.
- bitlab-lite puzzles.
- The `-Dmain=student_main` function-level test harness.
- The live in-browser Pipeline Explorer.
- Platform tags on prediction items.
- CS:APP page numbers, 15-213 F15 lecture numbers, and Erickson ch. 6 (DFS for Tideman).
- Bug items: `jl` vs `jb` (signed vs unsigned jumps), a `return a-b` comparator that overflows, and `for (unsigned i=n-1; i>=0; i--)`.

**New from me:**
- The `leakcheck.h` browser memory checker (verified) for the M5 project.
- A helper API that needs no `&` before pointers are taught.
- Event-loop oracle outputs generated by running the equivalent JS in Node at build time, so answers come from real runs.

**Errors fixed:**
1. L5 timestamps re-based (−1 h).
2. Cash uses cents and positive ints.
3. Endianness in code moved to M5. M2 shows byte order only in the byte viewer.
4. Struct padding comes after structs (M7).
5. Function pointers, `qsort` and `void*` come after pointers (M8.1).
6. M1 helpers return values (`int get_int(const char*)`). The out-parameter version arrives in M5.3.
7. Hours were raised where projects equal CMU or CS50 labs: cachesim + transpose 6 h; Tideman 5.5 h; Media Lab 7.75 h; allocator 25 h.
8. Wordle is marked "not in CS50x 2026; optional".
9. Every video segment longer than about 6 minutes gets in-video pause points with a prediction question, to keep the ≤250-words-or-one-video rule.

---

## 3. Global design (applies to every module)

**Pacing and lesson anatomy**
- Each lesson is 3–6 cards and takes 30–60 minutes.
- Before each interaction a card holds at most about 250 words, *or* one 30–90 s animation, *or* one video segment cut at pause points no more than 6 minutes apart.
- The content build lints the word count between interactive blocks.

**Interaction codes**

| Code | Meaning |
|---|---|
| PR | Predict before running. The answer is pipeline-run output, platform-tagged `wasm32`, `linux-x86_64` or `macos-arm64`. |
| CT | Write code checked by automated tests |
| FB | Fix a bug, starting from a symptom |
| MD | Fill in a memory diagram |
| PA | Parsons problem (put the lines in order) |
| CE | Interpret a real compiler, linker, sanitizer or Valgrind message, stored per compiler (clang 22 browser, gcc 13 WSL, Apple clang) |
| SP | Stepper: predict the next state |
| NP | Number-playground drill |
| TT | Trace table |
| AS | Read or match assembly |
| DB | Debugger task |
| BENCH | Measure, then predict |

**Rules for predictions and UB**
- Address values are never asked for, only their order or relationship.
- **UB is never used as a prediction answer.** Instead the question is "what will UBSan/ASan report?", answered with the stored native report.

**Hints and solutions**
- H1 is a concept nudge, H2 says where to look, H3 gives pseudocode or partial code.
- The solution unlocks after (≥2 substantive attempts, meaning a code change followed by a test run, *or* 20 minutes of active time) **and** after H3 has been viewed.
- A **variant exercise** must then pass before the skill counts as mastered.

**Retrieval quiz** at the start of each module: 6–10 items, about 10 minutes. Mix: about 40% from the previous module, 30% from two modules back, 30% from older ones. Missed checkpoint items are scheduled back in.

**Gated checkpoint** at the end of each module:
- 8–12 items, 30–45 minutes, pass mark **80%**.
- It always includes at least one CT, one FB, one MD or SP, one CE, and one *transfer* item set in an unfamiliar context.
- Items come from pools generated from verified snippets, so retakes draw fresh variants.
- The module project must also pass: the browser runner result, or a native **completion token**.
  - The token is the first 8 hex digits of SHA-256(module ID | learner seed | pass bitmap | runner version). `make test` prints it and the app recomputes it.
  - It is tamper-evident, not tamper-proof (honour system).
  - Progress lives in IndexedDB with JSON export and import.

**Where code runs**
- **[browser]**: wasm32 through the in-browser clang. Base flags: `-std=c17 -Wall -Wextra -pedantic -Wl,-z,stack-size=8388608`. Programs run in a separate Worker.
  - Guardrail mode adds `-fsanitize=undefined -fsanitize-trap=undefined` and maps `RuntimeError: unreachable` to "UB trapped".
  - From M5 on, tests also add `-include leakcheck.h`.
- **[native]**: the learner's own toolchain from M6 on.
- **[both]**: a diff panel showing stored native output next to browser output.

**Helper and licence guard**
- `learnc.h` (MIT) provides `int get_int(const char *prompt)`, `long long get_ll(const char *prompt)` and `const char *get_line(const char *prompt)`. They re-prompt on bad input and exit 1 on EOF. `get_line` uses a static buffer. *These signatures are a design choice; cs50-parity verified a `bool get_int(const char*, int*)` variant.*
- The learner replaces `get_line` with their own `realloc` version in M5.
- All specs, distribution code and data are original: CC0 images for Recover, Gutenberg texts, and a permissively licensed word list (licence still to be confirmed). Embedding CS50 YouTube segments is allowed.

**Native test runner**
- `make test` runs `check.py` (Python 3 standard library only).
- Steps: compile with `-Werror`, run I/O and unit tests, rerun under `-fsanitize=address,undefined`, then check leaks with LSan (Linux), `leaks --atExit` (macOS) or `valgrind --leak-check=full --error-exitcode=1` (WSL).
- A style check runs as warn-only.
- It prints the completion token.
- CI uses gcc for sanitizers, because clang 18 here lacks compiler-rt.

---

## 4. Course map

| # | Module | Runs | Hours | Weeks | Ends at week | CS50 week |
|---|---|---|---|---|---|---|
| 1 | C in Your Browser: From JS to C | browser | 10 | 2 | 2 | W1 |
| 2 | Bits, Bytes & Numbers | browser | 10 | 2 | 4 | W1 (Credit), W4 hex |
| 3 | Arrays, Strings & the Command Line | browser | 10 | 2 | 6 | W2 |
| 4 | Algorithms, Recursion, Structs & Big-O | browser | 17.5 | 3.5 | 9.5 | W3 |
| 5 | Pointers & Dynamic Memory | browser + [both] | 15 | 3 | 12.5 | W4 (a) |
| 6 | Going Native: Toolchain, Debugger, Sanitizers, Make | native | 10 | 2 | 14.5 | W2 compiling/debugging, W4 Valgrind |
| 7 | Structs, Files & Binary Formats | native (browser snippets) | 15 | 3 | 17.5 | W4 (b) |
| 8 | Data Structures I: Lists, Stacks, Queues, Trees | native (browser visualizers) | 15 | 3 | 20.5 | W5 (a) |
| 9 | Data Structures II: Hash Tables, Tries & Speller | native (browser visualizers) | 15 | 3 | **23.5 ← CS50 C parity** | W5 (b) |
| 10 | Inside the CPU: Instructions, Registers & Assembly | native + browser | 15 | 3 | 26.5 | — |
| 11 | Linking, Loading, Libraries & the C ABI | native | 10 | 2 | 28.5 | — |
| 12 | Memory Hierarchy & Performance | native + browser simulator | 12.5 | 2.5 | 31 | — |
| 13 | The Operating System (POSIX) | native | 15 | 3 | 34 | — |
| Cap | Build `malloc` (or Speller Pro) | native | 25 | 5 | 39 | — |
| | **Total** | | **195 h** | **39 wk** | | |

---

## 5. Modules

### M1. C in Your Browser: From JS to C (10 h, 2 weeks, [browser])
**Why it matters:** the learner writes real C on day one with nothing to install. Real compiler diagnostics break the "types are labels" habit from TypeScript: in C, types are memory layouts.

**Time:** lessons 4 h · problem set 2 h · project 2 h · variants 1 h · diagnostic + checkpoint 1 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 1.1 | Hello, compiled world (40) | `main`, `#include`, `printf`, exit status; compiling vs JIT. Delete `#include`: clang errors, gcc only warns | PR (escape sequences), CE | A1, V7 (live) |
| 1.2 | Types are layouts (45) | `int`/`char`/`double`/`bool`, format specifiers; `7/2`, `-7/2`; `double avg = 7/2` compiles with no warning | PR, CE (`-Wformat`), NP teaser | V1 |
| 1.3 | Control flow (40) | if, switch fall-through, while/for, the do-while re-prompt idiom; `=` vs `==` (`-Wparentheses`) | PA, FB (off-by-one pyramid), PR | — |
| 1.4 | Functions and scope (45) | Prototypes (no hoisting), pass by value, block scope, uninitialized locals are garbage, no closures; `enum`/`#define` instead of magic numbers | PR ("does the caller's variable change?"), CT `max3` | V3 teaser |
| 1.5 | Input without magic (40) | `learnc.h` source visible; `scanf` pitfalls | CT Hello-It's-Me (empty name re-prompts) | — |
| 1.6 | Read the compiler like a linter (35) | Fix the first error first; a missing `printf` argument prints `score 0` in the browser but garbage natively; four-stage overview | CE ×5, PR [both] | Y3 (pauses at 00:50:00 and 00:55:00) |

- **Problem set:** Hello, World; Hello, It's Me; Mario-less (warm-up); **Cash** (cents, int > 0, greedy). The Cash variant shows that greedy fails for coins {1, 3, 4}.
- **Project P1, Mario-more (required).** The runner checks:
  - re-prompting on 0, 9, −1, `abc`, empty input and `42x`;
  - byte-exact output for heights 1–8, including the two-space gap and no trailing spaces;
  - a clean `-Werror` build in the browser;
  - the pipeline confirms gcc and clang native output is identical.
- **Checkpoint:** 3 PR, 2 CE, 1 PA, 2 CT micro-functions. Transfer FB: a do-while re-prompt that accepts 0.
- **Retrieval:** a JS diagnostic (`typeof null`, `0.1+0.2`, `Number.MAX_SAFE_INTEGER`, hoisting, `===`).
- **Resources:** Beej v0.11.0 ch. 2 "Hello, World!", 3 "Variables and Statements", 4 "Functions"; K&R 2e ch. 1 §1.1–1.10.
- **Success criteria:** SC1 (I), SC3 (I), CS50 W1.

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| `let x: number` ↔ `int x` | 1.2 | TS types are erased; C types set size and instructions; truncation is silent |
| `console.log` ↔ `printf` | 1.1, 1.6 | The format string must match the argument types; a mismatch is UB, not coercion |
| `Math.trunc(a/b)` ↔ `int/int` | 1.2 | In C it happens implicitly whenever both operands are ints |
| `let` scope ↔ block scope | 1.4 | No TDZ and no `undefined`: an uninitialized local is garbage |
| Function hoisting | 1.4 | None in C; you need a prototype before the call |

### M2. Bits, Bytes & Numbers (10 h, 2 weeks, [browser])
**Why it matters:** JS hides everything behind one IEEE double. Pointers, files, hashing and assembly all assume fluency with widths, signedness and bytes. CSS colours and TypedArrays make good hooks.

**Time:** lessons 4.2 h · problem set 2 h · project 2.5 h · variants 0.5 h · quiz + checkpoint 0.75 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 2.1 | Binary and hex (40) | Place value, nibbles, `#RRGGBB`, `%x`; `0b101` is not C17 (pedantic warning) | NP, PR, CE | V1, Y2 |
| 2.2 | Widths and `sizeof` (40) | `<stdint.h>`, `size_t`; the wasm32 / x86-64 / arm64 size table (`long` is 4 in wasm32) | PR (platform-tagged) | V1, V2 |
| 2.3 | Unsigned and two's complement (45) | Unsigned wrap is defined, signed overflow is UB; casts; `-1 < 0u` is 0; `sizeof(x)-5 > 0`; guardrail mode | PR, NP, CE (`-Wsign-compare`), FB `for (unsigned i=n-1; i>=0; i--)` | A3, V1 |
| 2.4 | Bitwise operators and masks (45) | `& | ^ ~ << >>`, flags, RGBA packing; over-shifting is UB; `1u << 31`; `-7>>1` is implementation-defined | CT pack/unpack, FB | V1 |
| 2.5 | Floating point (45) | IEEE fields; `0.1+0.2` is the same as JS; `16777217.0f` becomes 16777216; epsilon compares; NaN/Inf; `round(-2.5)` = −3 vs `Math.round` = −2 | NP, PR | A4, V1, Y1 (pauses at 02:22:14 and 02:27:44) |
| 2.6 | Characters and encodings (40) | ASCII; `char` is a small int whose signedness varies (unsigned on aarch64-Linux); UTF-8 vs UTF-16: `strlen("é")` = 2, 👍🏽 is 8 bytes / 2 code points / 4 UTF-16 units; byte order shown **in the viewer only** | PR, MD (bytes in V2) | V2 |

- **Problem set:**
  - **bitlab-lite**: 6 puzzles under operator restrictions (getByte, bitCount, isPowerOfTwo, absVal…). Tested exhaustively over 8-bit values plus edge values (0, −1, INT_MIN, INT_MAX), built with the UB trap. A token scanner enforces the allowed operators.
  - `hexcolor`: parse `#RGB`/`#RRGGBB` and blend two colours.
- **Project P2, Credit (Luhn).** The runner checks:
  - at least 20 cases: AMEX (15 digits, 34/37), MasterCard (16 digits, 51–55), VISA (13/16 digits, starting 4), Luhn-valid numbers with the wrong prefix or length, Luhn-invalid numbers, and 10-digit numbers;
  - non-numeric input re-prompts;
  - **identical output on wasm32 and native**, which fails if the learner used `long`;
  - a `-Werror` build with the UB trap.
- **Checkpoint:** 4 NP/PR conversions, 2 PR (overflow, float), 1 MD (byte order in V2), 2 CT bit functions. Transfer: RGB565 pack/unpack.
- **Retrieval:** M1.
- **Resources:** CS:APP 3e §2.1–2.4 (pp. 34–125); Beej ch. 24 "Bitwise Operations" and ch. 37 "Fixed Width Integer Types".
- **Success criteria:** SC7 (I→A), SC3 (D), CS50 W1 (Credit) and W4 (hex).

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| `x|0`, `x>>>0` ↔ `int32_t`/`uint32_t` | 2.3–2.4 | C signed overflow is UB, not wrap; C has many widths; over-shifting is UB |
| `Uint8Array`/`Int16Array` ↔ fixed-width types | 2.2 | No bounds checks in C |
| `DataView` ↔ byte order | 2.6 | `DataView` defaults to **big-endian**; C on x86, ARM and wasm is little-endian and implicit |
| `0.1+0.2` | 2.5 | Identical; but C also has `float` (24-bit significand) and a platform-dependent `long double` |
| `BigInt` | 2.2 | C has no arbitrary-precision integers |
| React lanes / bit flags | 2.4 | Same idea, but C flags can be unsigned 64-bit |

### M3. Arrays, Strings & the Command Line (10 h, 2 weeks, [browser])
**Why it matters:** the first module where C has no safety net. Strings become NUL-terminated bytes, `==` compares addresses, and the learner builds real command-line tools.

**Time:** lessons 3.9 h · problem set 2.5 h · project 2 h · variants 0.75 h · quiz + checkpoint 0.75 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 3.1 | Arrays (40) | Contiguous, no `.length`, no bounds checks (the browser silently reads garbage); `sizeof a / sizeof a[0]`; a parameter is 4 vs 8 bytes (`-Wsizeof-array-argument`) | PR [both], MD, FB | V2 |
| 3.2 | Strings are char + NUL (45) | `"hello"` is 6 bytes; `<string.h>`; `strlen` is O(n); `==` vs `strcmp`; `snprintf` | PR, MD | V2, Y4 (pause at 01:38:42) |
| 3.3 | Character arithmetic (35) | `<ctype.h>` (cast to `unsigned char`), `'a'+k`, modular rotation | CT `rotate()`, PR | V1 |
| 3.4 | Text statistics and rounding (35) | Counting letters, words, sentences; Coleman–Liau; `round` and `-lm` (native note) | CT, PR | — |
| 3.5 | `argc`/`argv` and exit codes (40) | `strtol` vs `atoi`, `return 1`, `argv[0]` | CT (args panel), FB (`argv[1]` missing: browser traps, native segfaults) | — |
| 3.6 | 2D arrays and defensive strings (40) | Row-major order; arrays of strings; buffer overflow; `fgets`; `gets` removed in C11 | MD, FB (missing NUL), CE | V2 |

- **Problem set:** Scrabble; Readability ("Before Grade 1" and "Grade 16+"); Caesar (warm-up). Optional Wordle (older CS50 editions only).
- **Project P3, `cipher`** (Caesar + Substitution + `-d` to decrypt). The runner checks:
  - usage message and exit 1 for missing or extra arguments;
  - Caesar: non-numeric k rejected; k > 26 wraps;
  - Substitution key: 26 letters, alphabetic only, no duplicates (case-insensitive);
  - case preserved and non-letters passed through;
  - **decrypt(encrypt(x)) == x on 200 random strings**;
  - exit 0 on success.
- **Checkpoint:** 3 PR [both] (`sizeof` vs `strlen`), 1 MD, 2 CE, 2 CT, 1 FB. Transfer: Vigenère.
- **Retrieval:** M2 (60%), M1 (40%).
- **Resources:** Beej ch. 6 "Arrays", 7 "Strings", 18 "The Outside Environment"; Effective C 2e ch. 7 "Characters and Strings" (p. 137).
- **Success criteria:** SC3 (D), SC7 (D), CS50 W2.

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| `Array` ↔ C array | 3.1 | Fixed size, one type, no `.length`; out of bounds gives garbage, not `undefined`; cannot be assigned or returned |
| `string` ↔ `char[]` | 3.2 | Mutable UTF-8 bytes, not immutable UTF-16; length is found by scanning; `==` compares addresses |
| `process.argv` ↔ `argv` | 3.5 | In C `argv[0]` is the program; Node's `argv[0..1]` are node and the script |
| Template literals ↔ `snprintf` | 3.6 | You supply the buffer and its size |

### M4. Algorithms, Recursion, Structs & Big-O (17.5 h, 3.5 weeks, [browser])
**Why it matters:** it gives the vocabulary of cost behind `.sort()` and `.includes()` and a first look at the real call stack. It also teaches the graph reasoning Tideman needs, which CS50 leaves to the learner.

**Time:** lessons 5.25 h · problem set 4 h · project 5.5 h · variants 1.5 h · quiz + checkpoint 1.25 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 4.1 | Search and Big-O (45) | Linear vs binary search; O/Ω/Θ; `lo+(hi-lo)/2` | PR (comparison counts), TT, FB (infinite loop) | V9 |
| 4.2 | Simple sorts (50) | Bubble (early exit gives Ω(n)), selection, insertion; invariants; stability | PA, TT | V9 |
| 4.3 | Recursion and the call stack (50) | Base case, frames. Depth demo: browser traps or raises `RangeError`, native gets SIGSEGV. Predict the outcome, not frame counts | SP, PR [both] | A5, V3 |
| 4.4 | Merge sort (50) | Divide and conquer, n log n, merge buffer | CT `merge_sort`, PR | A6, V9, Y5 (pause at 01:53:41) |
| 4.5 | Structs, first contact (40) | `struct candidate`, `typedef`, arrays of structs, designated initializers, **assignment copies** | PR (copy surprise) | V3 |
| 4.6 | Measuring growth (35) | `timespec_get`, doubling experiments, log–log plots; browser timer precision is reduced | BENCH, PR | V9 |
| 4.7 | Graphs for elections (45, required) | Adjacency matrix; DFS cycle detection; ranked-pairs intuition | TT, CT `creates_cycle` | V9 graph mode |

- **Problem set:**
  - **Which Sort?** Three mystery wasm binaries, identified by timing on sorted, reversed and random input. **Then implement all three** and submit a doubling table that matches the Big-O claims.
  - Plurality.
  - Runoff (optional warm-up).
- **Project P4, Tideman (required).** The runner compiles with `-Dmain=student_main` and links a hidden harness. It unit-tests:
  - `vote` (rejects unknown names);
  - `record_preferences`;
  - `add_pairs` (excludes ties);
  - `sort_pairs` (by strength, descending);
  - `lock_pairs` (direct, 3-cycle, indirect, multiple cycles, final pair locked when safe);
  - `print_winner`;
  - plus end-to-end ballots and a 9-candidate × 1000-voter time limit.
- **Checkpoint:** 4 Big-O classifications, 2 TT, 1 SP (stack frame), 1 PA, 2 CT (count inversions with merge sort; a new problem), 1 FB (binary search). Transfer: choose an algorithm from constraints.
- **Retrieval:** M3, M2, M1.
- **Resources:** CLRS 4e ch. 2 "Getting Started" and ch. 3 "Characterizing Running Times"; Erickson *Algorithms* ch. 6 "Depth-First Search" (free PDF).
- **Success criteria:** SC6 (A), SC2 (I: frames), SC3 (D: structs), CS50 W3.

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| "Maximum call stack size exceeded" | 4.3 | Natively it is SIGSEGV and cannot be caught; the limit is in bytes, not frames |
| Objects by reference ↔ structs | 4.5 | Assigning or passing a struct copies the whole thing |
| `includes` vs `Set.has` / binary search | 4.1 | Same cost intuition |
| `performance.now()` | 4.6 | Browser timers are coarsened on purpose |

### M5. Pointers & Dynamic Memory (15 h, 3 weeks, [browser] + [both] panels)
**Why it matters:** this is the core skill gap. In wasm32, memory really is one `ArrayBuffer` and a pointer really is a byte offset, so the concept is concrete. The [both] panels show what native code does differently.

**Time:** lessons 5.7 h · project 5.5 h · variants 2 h · quiz + checkpoint 1.25 h · slack 0.5 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 5.1 | Addresses (40) | `&`, `%p`; memory as one big `Uint8Array` (the live `WebAssembly.Memory`) | PR (relationships), MD | V2 live |
| 5.2 | Dereferencing and NULL (45) | `*`, typed pointers. A NULL read prints 0 in the browser but SIGSEGVs natively; guardrail mode traps it | PR [both], MD | V4, Y6 |
| 5.3 | Swap and out-parameters (40) | `swap`; `scanf` needs `&`; `bool get_int_r(const char*, int *out)`; returning several values | SP, FB (broken swap) | A7, V3, V4 |
| 5.4 | Pointer arithmetic and arrays (45) | `a[i] ≡ *(a+i)`, decay, one past the end; **print a `uint32_t`'s bytes through `unsigned char*`** to get `04 03 02 01` | PR, PA | V2, V4 |
| 5.5 | Code, static, stack, heap (45) | Place 20 declarations; lifetimes; returning a local's address (gcc `-Wreturn-local-addr`, clang `-Wreturn-stack-address`) | MD, PR [both] on address order: native code < globals < heap < stack; wasm32 stack < globals < heap | A8, V3, Y7 |
| 5.6 | `malloc`/`calloc`/`realloc`/`free` (50) | `sizeof *p`, NULL checks, ownership, double free, leaks; `leakcheck.h` reports in the browser; use-after-free "works" on both targets (UB is not a crash) | FB, SP, CE (leakcheck reports) | V3 heap |
| 5.7 | Strings revisited, `char **` (45) | Literals are read-only (browser prints `Jello`, native segfaults); copying strings; arrays of pointers; the `argv` layout | PR [both], MD | V4 argv mode |
| 5.8 | `const` and ownership (30) | `const T*` vs `T* const`; documenting who frees | PA, CE | — |

- **Project P5, `libstr`:** `str_dup`, `str_concat_alloc`, `str_split` (returns `char**` and a count), `str_join`, `str_trim`, `str_replace_all`, `strv_free`, and `get_line(FILE*)` using `realloc` doubling. **This replaces the course helper.** The browser runner checks:
  - unit tests: empty strings, delimiters at the edges and repeated, 64 KiB lines;
  - 1000 randomized property tests against a reference;
  - **`-include leakcheck.h`: zero leaks, zero canary overflows, zero invalid frees**;
  - the UB-trap build passes;
  - in-browser `nm` shows no `strdup`/`strndup`.
  - In M6 the same tests are rerun natively under ASan, which catches the reads and use-after-free the shim misses.
- **Checkpoint:** 3 MD, 2 SP, 2 PR [both], 1 FB (leak + use-after-free), 2 CT. Transfer: reverse words in place using only pointers.
- **Retrieval:** M4 (frames), M3 (NUL), M2 (hex, sizes).
- **Resources:** K&R 2e ch. 5 §5.1–5.6; Beej ch. 5 "Pointers—Cower In Fear!", 11 "Pointers II: Arithmetic", 12 "Manual Memory Allocation".
- **Success criteria:** SC2 (A), SC3 (A), SC4 (I), SC7 (D), CS50 W4.

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| Object references ↔ pointers | 5.2–5.3 | Pointers support arithmetic, can dangle, can point at any variable including ints; NULL dereference is UB, not a TypeError |
| `ArrayBuffer`/`WebAssembly.Memory` ↔ address space | 5.1, 5.4 | **Exactly true in wasm32**; native memory is 64-bit virtual with ASLR and protected pages, which is why NULL crashes only natively |
| GC ↔ `free` | 5.6 | You choose lifetimes. A JS leak is still-reachable data; a C leak is unreachable but never freed |
| `arr.push` growth ↔ `realloc` doubling | P5 | `realloc` may move the block, so old pointers become invalid |
| Swap two ints | 5.3 | Impossible in JS, trivial in C |

### M6. Going Native: Toolchain, Debugger, Sanitizers & Make (10 h, 2 weeks, [native])
**Why now:** the M5 bugs are invisible in the browser and ASan cannot link there. Locally, ASan names the file and line. The learner sets up a toolchain at the moment they want one.

**Time:** lessons 4.75 h (including 1 h install) · project 3 h · variants 0.75 h · quiz + checkpoint 1 h · install buffer 0.5 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 6.1 | Install and doctor (60) | macOS `xcode-select --install`; Windows `wsl --install` then `sudo apt install build-essential gdb valgrind`; VS Code + clangd + CodeLLDB. `doctor.sh` prints `uname -m`, compiler, `sizeof` table, builds hello with strict flags, runs an ASan smoke test and prints a token. Apple Silicon is arm64; Windows-on-ARM is aarch64 with **unsigned `char`** | CT (doctor passes) | A9 |
| 6.2 | Compiling by hand (40) | `-o -g -O0/-O2 -Werror`; `-lm` (glibc needs it; macOS does not); rerun `sizes.c` and predict 8-byte `long` | PR [both] | A2, V7 |
| 6.3 | Debugger (60) | lldb and gdb side by side: `break`, `run`, `next`, `step`, `finish`, `bt`, `print`/`frame variable`, `watch`, `x` | FB (segfault → `bt`), DB ("`i` at the 3rd hit?" answered by a native run), SP | V3 bridge, Y8 |
| 6.4 | Sanitizers (50) | ASan and UBSan; LSan on Linux; `leaks --atExit` on macOS; rerun P5 tests | CE (real reports) | — |
| 6.5 | Valgrind on Linux/WSL (30) | definitely vs indirectly lost; invalid read/write; uninitialised conditional jump | CE | Y9 |
| 6.6 | Two files and a Makefile (45) | `.h`/`.c`, include guards, `extern`/`static`, declaration vs definition; a Make-3.81-safe Makefile; `undefined reference` and `multiple definition` | PA, CE, CT (split `cipher` into files) | V7 |

- **Project P6, Bug Hunt:** six programs with symptom-only reports, such as "garbage sometimes", "crashes on long names", "memory grows" and "wrong after second call". For each, the learner reproduces, locates, fixes, and writes up the fix in `diagnosis.md`. The runner checks:
  - builds with `-g -fsanitize=address,undefined`;
  - **zero sanitizer reports** on scripted cases;
  - Valgrind (WSL) or `leaks` (macOS) clean;
  - `diagnosis.md` names the right file and line;
  - P5 tests pass under ASan;
  - token printed.
- **Checkpoint:** 3 CE (ASan, UBSan, Valgrind), 2 PA (debugger commands), 1 local FB (token), 2 PR, 1 MD. Transfer: classify 3 failures by stage.
- **Retrieval:** M5, M4 (stack), M2.
- **Resources:** Effective C 2e ch. 11 "Debugging, Testing, and Analysis" (p. 229; AddressSanitizer p. 253); GNU Make 4.4.1 manual ch. 2 "An Introduction to Makefiles".
- **Success criteria:** SC4 (A), SC1 (D), SC11 (I), CS50 W2 (compiling, debugging) and W4 (Valgrind).

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| DevTools Sources ↔ lldb/gdb | 6.3 | No hot reload; optimized builds show `<optimized out>`; a crash is a signal |
| Source maps ↔ `-g` (DWARF) | 6.2 | Close match, but you must rebuild |
| Heap snapshot ↔ LSan/Valgrind | 6.4–6.5 | The definition of a leak is opposite |
| npm scripts ↔ Makefile | 6.6 | Make is a timestamp-driven dependency graph with TAB-sensitive recipes |
| `import` ↔ `#include` | 6.6 | Textual paste; no module scope; declaration ≠ definition |

### M7. Structs, Files & Binary Formats (15 h, 3 weeks, [native]; snippets and BMP preview in browser)
**Why it matters:** real data has byte-level layouts. Image filters give this visual audience instant feedback. It also covers padding and endianness in practice.

**Time:** lessons 4.25 h · Volume 1.25 h · project 6.5 h · variants 1.5 h · quiz + checkpoint 1.25 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 7.1 | Structs in depth (40) | `->`, struct pointers, compound literals, value vs pointer passing | PR, CT | V4 |
| 7.2 | Alignment and padding (45) | `offsetof`; `{char;long;char}` is 24 bytes on x86-64 vs 12 on wasm32; reorder 12 → 8; a list node is 16 vs 8; `_Alignof`; read headers field by field, don't `fread` into a padded struct | PR [both] (three targets), MD (padding bytes) | V2 target toggle |
| 7.3 | Text streams (40) | `FILE*`, modes, `fgets`/`fprintf`, `perror`/`errno`, stderr, exit codes | CT `cp`, FB (unchecked `fopen`) | Y10 |
| 7.4 | Binary I/O (45) | `fread`/`fwrite` size and count, short reads, `feof` vs `ferror`, the `while(!feof)` bug, the `"b"` mode; WAV 44-byte header; int16 scale and clamp | PR (`fread` return value), FB, CT Volume | V2 WAV overlay |
| 7.5 | Images as pixel arrays (50) | BMP 14+40-byte headers, BGR, bottom-up, rows padded to 4 bytes; `RGBTRIPLE (*img)[w] = calloc(h, sizeof *img)` (VLA type; optional in C17, supported by gcc and clang); kernels | CT, PR (3×3 blur value), FB (streaky in-place blur) | A10, V2, BMP preview |
| 7.6 | Signatures and recovery (35) | `ff d8 ff e?` (mask `0xf0`), 512-byte blocks, a state machine, `"%03i.jpg"`; a mini `xxd` | CT | A11, V2 |

- **Problem set:** Volume, sample-exact on 3 WAVs including clipping.
- **Project P7, Media Lab:** **all five filters** (grayscale, sepia, reflect, blur, edges) plus **Recover**. The runner checks:
  - per-function tests on 1×1 to 4×4 images against native reference values;
  - edges and corners; rounding and capping at 255; reflect with odd and even widths;
  - whole-image byte comparison with headers preserved;
  - a **4000×3000 image** runs without stack overflow;
  - Recover: a synthetic card from CC0 images with junk before the first JPEG and zero-filled slack; file count and SHA-256 of each recovered file; names from `000.jpg`; usage errors exit 1;
  - ASan/UBSan clean, Valgrind or `leaks` clean, all files closed.
- **Checkpoint:** 2 PR (layout, [both]), 1 MD (a padded BMP row), 1 V2 task (read width, height and bit depth), 2 CE (Valgrind), 2 CT (crop, vertical flip), 1 FB (padding misread). Transfer: parse an unseen header spec.
- **Retrieval:** M6, M5, M3, M2.
- **Resources:** Beej ch. 9 "File Input/Output" and ch. 20 "structs II"; Effective C 2e ch. 8 "Input/Output" (p. 167, "Endian" p. 191).
- **Success criteria:** SC3 (A), SC7 (A), SC4 (D), SC10 (I), CS50 W4.

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| Object / TS interface ↔ struct | 7.1 | Fixed layout with padding; no dynamic keys; assignment copies |
| `DataView.getUint16(off, true)` ↔ reading fields | 7.2–7.4 | `fwrite` of a struct is not portable (padding, endianness, pointers) |
| `ImageData` ↔ BMP pixels | 7.5 | ImageData is RGBA, top-down, unpadded and **clamped**; BMP is BGR, bottom-up, padded, and `uint8_t` **wraps** |
| `fs.readFileSync` ↔ `FILE*` | 7.3–7.4 | You own the buffers; reads can be short; you must `fclose` |
| `File.slice()` ↔ 512-byte blocks | 7.6 | Close match |

### M8. Data Structures I: Lists, Stacks, Queues, Trees (15 h, 3 weeks; projects [native], visualizer lessons [browser])
**Why it matters:** learners use `push`, `shift` and `Map` daily without knowing the cost. Building the structures themselves, and an event loop out of them, turns pointer skill into fluency.

**Time:** lessons 4.35 h · Inheritance 2 h · project 5.5 h · variants 1.5 h · quiz + checkpoint 1.25 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 8.1 | ADTs, function pointers, generic code (45) | Opaque types, create/destroy pairs, ownership docs; function pointers; `qsort`/`bsearch` with `const void*` comparators | CT, FB (`return a-b` overflows at INT_MIN), CE (incompatible pointer type) | — |
| 8.2 | Dynamic arrays (35) | Doubling `realloc`, amortized O(1); the `p = realloc(p, n)` leak | PR (capacity sequence), FB | V3 |
| 8.3 | Singly linked lists (60) | Insert at head, tail and sorted; search; delete; free with a temp pointer; the `node **pp` trick | MD, SP, FB (use-after-free on `->next`) | A12, V4, Y11 |
| 8.4 | Stacks and queues (40) | Array stack, circular-buffer queue, linked versions; complexity table | CT, PR | V4 |
| 8.5 | Binary search trees (50) | Recursive insert, search, delete; traversals; height; degeneration on sorted input; post-order free | SP, PA, CT | V4, Y12 |
| 8.6 | Recursive ownership (30) | Allocating and freeing a family tree | CT | V3 |

- **Problem set: Inheritance.** The runner checks, over 1000 seeded runs:
  - the generation count is right;
  - parent pointers are NULL only in the oldest generation;
  - every allele comes from a parent;
  - zero leaks.
- **Project P8, `eventloop`.** Input scripts look like `setTimeout A 10`, `then B`, `queueMicrotask C`, `log D`.
  - Macrotask queue = growable circular buffer; microtask queue = linked-list queue; timers = BST keyed by `(time, seq)`. Output is the execution order.
  - **Expected outputs come from running equivalent JS in Node at build time.**
  - The runner checks:
    - 30 scripts match Node's order;
    - microtasks drain before the next macrotask; nested `then`; equal-delay timers keep insertion order;
    - unit tests for the queue and BST modules;
    - 10⁵ events within the time limit;
    - ASan clean and zero leaks.
- **Checkpoint:** 2 MD (list after 4 operations; BST after inserts and a delete), 1 SP, 2 CT (reverse a list in place; BST height), 1 FB (lost head or realloc leak), 1 PR (traversal orders). Transfer: a complexity table for a new ADT.
- **Retrieval:** M7 (`->`), M5 (`free`), M4 (recursion, Big-O), M6 (reading ASan).
- **Resources:** K&R 2e §5.11 "Pointers to Functions" (p. 118) and §6.5 "Self-referential Structures" (p. 139).
- **Success criteria:** SC5 (A: lists, stacks, queues, BSTs), SC3 (A), SC6 (D), SC4 (D), SC11 (D), CS50 W5.

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| React Fiber `child`/`sibling`/`return` ↔ linked nodes | 8.3 | No GC: unlinking without freeing leaks |
| `arr.shift()` ↔ queue | 8.4 | Naive shifting is O(n); a circular buffer is O(1) with no auto-resize |
| DOM tree ↔ BST | 8.5 | You own every node's memory |
| `arr.sort(cmp)` ↔ `qsort` | 8.1 | `void*` arguments, no closures (`qsort_r` is non-standard), no stability guarantee (V8's TimSort is stable) |
| Event loop | P8 | Same semantics, built from your own queues |
| `Map` ↔ BST | 8.5 | `Map` keeps insertion order; a BST keeps sorted order |

### M9. Data Structures II: Hash Tables, Tries & Speller (15 h, 3 weeks; project [native]) → CS50 C parity
**Why it matters:** `Map`, `Set` and object keys are hash tables these learners have never seen inside. Speller is CS50's showcase problem set. Ours adds a performance gate.

**Time:** lessons 4 h · problem set 1.5 h · project 6.5 h · variants 1.5 h · quiz + checkpoint 1.25 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 9.1 | Hashing (40) | djb2, FNV-1a; uniformity; power-of-two mask vs `%`; case folding; `(unsigned char)` cast | PR (bucket indices), CT | V5 |
| 9.2 | Separate chaining (45) | Load factor, resize and rehash, key ownership (`strdup` is POSIX/C23, so write your own) | CT, SP | A14, V5, Y13 (pauses at 01:45:25 and 01:53:52) |
| 9.3 | Open addressing (40) | Linear probing, tombstones, clustering; preview of cache effects | SP | V5 probing mode |
| 9.4 | Tries (40) | 27-way nodes; memory cost (216 B per node native vs 108 B on wasm32); O(L) lookup | MD, PR (bytes used) | V5 trie mode |
| 9.5 | Measuring honestly (40) | `clock_gettime(CLOCK_MONOTONIC)` (POSIX) or `timespec_get`; `getrusage`; `-O2`; warm-up; median; a counting allocator wrapper | BENCH | — |
| 9.6 | Speller design studio (35) | `dictionary.h` contract (`load`/`check`/`size`/`unload`), `LENGTH 45`, apostrophes; `strcasecmp` is POSIX `<strings.h>`, not C17 | PA, CT | — |

- **Problem set:** word-frequency counter (hash map from string to count; top-k with `qsort`).
- **Project P9, Speller.** A hash-table backend is required; a trie backend is optional (fully done in capstone Track B). The runner checks:
  - output identical to the reference (misspelled words, WORDS MISSPELLED / IN DICTIONARY / IN TEXT, TIME IN load/check/size/unload/TOTAL) on at least 10 public-domain texts × 2 dictionaries;
  - case-insensitivity and apostrophes; `size` correct;
  - `unload` frees everything (ASan/LSan, Valgrind or `leaks`);
  - **total `check` time at least k× faster than a provided sorted-array + `bsearch` baseline on the same machine**;
  - the report file parses.
- **Checkpoint:** 1 V5 item (predict collisions, probes and a resize), CT (open-addressing int set with delete), FB (`int h = h*31 + c` with signed `char` gives a negative index on x86-64 and macOS but not on aarch64-Linux), CE (ASan heap overflow at a bucket index), PR (complexity).
- **Retrieval:** M8, M7, M2 (masks, `char` signedness), M4 (Big-O).
- **Resources:** K&R 2e §6.6 "Table Lookup" (p. 143).
- **Success criteria:** SC5 (A: hash tables, tries), SC6 (A), SC4 (A), CS50 W5. **All CS50x 2026 C problem sets are matched by week 23.5 (117.5 h).**

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| `Map`/`Set` ↔ hash table | 9.1–9.3 | You choose the hash, collision policy, resizing and key ownership; no insertion order |
| `performance.now()` ↔ `clock_gettime` | 9.5 | Native timers are precise; noise comes from the machine instead |
| String keys | 9.6 | C compares bytes; case folding is done by hand |

### M10. Inside the CPU: Instructions, Registers & Assembly (15 h, 3 weeks; [native] plus browser TinyCPU and static assembly)
**Why it matters:** it shows what the learner's C becomes. Mac learners see arm64 and WSL learners see x86-64, so every listing is shown in both. Cross-target `clang -S` from one Linux CI box was verified by two drafts.

**Time:** lessons 6 h · TinyCPU problem set 2.5 h · project 4.5 h · variants 0.75 h · quiz + checkpoint 1.25 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 10.1 | Machine model (45) | Registers, PC, flags, memory; fetch–decode–execute on a toy ISA | SP | A15, V10 |
| 10.2 | Write the decode loop (45) | TinyCPU core in C: `uint8_t mem[65536]`, bit-field decode, `switch` dispatch | CT | V10 |
| 10.3 | From C to assembly (45) | `-S -O0/-O1`; `-fcf-protection=none` for clean listings; wasm is a stack machine | PR ("which C line?") | V7 |
| 10.4 | Moves and arithmetic (45) | `leal (%rdi,%rsi),%eax` vs `add w0,w1,w0`; `movslq`/`ldrsw`; `eax`/`rax`, `w0`/`x0` | PR, PA | V7 |
| 10.5 | Control flow (45) | `cmp`/`test` + `jcc`/`b.cond`; loops; jump tables; **`jl` vs `jb` = signed vs unsigned** | AS, PA | V7, V10 |
| 10.6 | Procedures and the stack (50) | `call`/`ret`/`bl`; SysV (rdi, rsi, rdx, rcx, r8, r9 → rax) vs AAPCS64 (x0–x7 → x0); caller- vs callee-saved; 16-byte alignment; how a stack smash overwrites the return address | SP (register traces), MD | A16, V10, V3 |
| 10.7 | Data in assembly (40) | `(%rdi,%rcx,4)` vs `ldrsw x9,[x0],#4`; field offsets = `offsetof` | PR, MD | V7 |
| 10.8 | `-O2` and instruction-level debugging (45) | Constant folding, inlining, how the optimizer exploits UB, `volatile`; `disassemble`, `stepi`, `register read`, `x/16xb` | PR ("what disappears?"), DB | V10 |

- **Problem set: TinyCPU emulator.** The runner compares golden per-step register and memory traces on 20 programs, checks the instruction budget, and checks the stack is balanced.
- **Project P10, Asm Detective.**
  - (a) A **per-learner seeded** `phases.o` (x86-64 ELF, arm64 Mach-O, aarch64 ELF) that the learner **links** with the provided `main.c`. Five phases: string compare, arithmetic loop, jump table, recursion, linked nodes. Defused by reading disassembly with lldb or gdb.
  - (b) Two "write C equivalent to this listing" items, checked with hidden test vectors plus an instruction count at or below target at `-O1`.
  - (c) Register values at a breakpoint, parsed from a gdb/lldb batch log.
  - The runner requires every phase defused and prints a seeded token.
- **Checkpoint:** 3 asm→C items (learner's ISA), 1 MD (calling convention), 1 PA, 2 SP (register traces), 1 interpret real `bt`/`frame` output. Transfer: predict a mystery function's return value.
- **Retrieval:** M9, M5 (frames), M2 (two's complement), M7 (`offsetof`).
- **Resources:** CS:APP 3e §3.1–3.7 (pp. 163–254; optional §3.10.2 "Using the gdb Debugger", p. 279); CMU 15-213 F15 Lecture 6 "Machine Prog: Control" and Lecture 7 "Machine Prog: Procedures".
- **Success criteria:** SC8 (A: CPU, registers), SC9 (A), SC2 (A: frames in assembly).

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| V8 JIT ↔ ahead-of-time compiler | 10.3, 10.8 | A JIT speculates and deoptimizes; C is compiled once, with no guards |
| wasm in DevTools ↔ asm | 10.3 | wasm is a stack machine; CPUs are register machines |
| DevTools call stack ↔ frames | 10.6 | Real frames are bytes holding a return address that can be overwritten |
| Event loop ↔ fetch–decode–execute | 10.1 | The CPU never waits on tasks; interrupts are hardware events |

### M11. Linking, Loading, Libraries & the C ABI (10 h, 2 weeks, [native])
**Why it matters:** it explains "undefined reference" errors and completes the source-to-process story. The C ABI is what N-API, ctypes, Rust FFI and wasm exports all speak.

**Time:** lessons 4.2 h · project 4 h · variants 0.75 h · quiz + checkpoint 1 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 11.1 | The four stages, for real (45) | `-E`, `-S`, `-c`, link, `-v`; `nm`, `objdump`/`otool` | CE ("which stage failed?" ×6) | A2 recap, V7 |
| 11.2 | Symbols and linkage (45) | `extern`/`static`, the one-definition rule, strong and weak symbols, relocation; ELF vs Mach-O | CE, FB (missing `static` → duplicate symbol) | A17 |
| 11.3 | Libraries (40) | `ar`; `-fPIC -shared`; `-L`/`-l`; link order (GNU ld is order-sensitive, Apple ld is not, per docs); `ldd`/`otool -L`; rpath; `dlopen`/`dlsym` | CT, CE ("cannot open shared object file", dyld "Library not loaded") | V7 |
| 11.4 | Loading (40) | Segments, entry → `main`, dynamic loader, PLT/GOT idea; ASLR (order stays stable, values change) | PR [native] | A18, V2 |
| 11.5 | Make, properly (40) | Pattern rules, `$@ $< $^`, `-MMD -MP`, `-include` dependency files, `.PHONY`, `-j`; Make-3.81-safe | PA, CT | — |
| 11.6 | The C ABI and FFI (40) | Calling convention as ABI; struct layout as ABI; opaque pointers; `_sum` symbol naming on macOS; `extern "C"`; wasm exports (a JS-visible pointer such as 65536) | CT (call your C from JS in the browser) | V7 |

- **Project P11, Libify:** package the M9 hash table as `libdict.a` and `libdict.so`/`.dylib`, with an opaque `dict_t*`, `-fvisibility=hidden` plus explicit exports, and a versioned header; also a CLI, tests, and a Makefile with automatic dependencies. The runner checks:
  - the exported dynamic symbol set equals the public API (`nm -D` / `nm -gU`);
  - the client passes linked statically and dynamically;
  - touching one header rebuilds only its dependents (parsed from `make -n`);
  - **changing the internal struct and relinking only the shared library keeps the unchanged client binary working**;
  - stretch: the wasm build called from JS, and a `dlopen` hash plugin.
- **Checkpoint:** 3 CE (preprocess, compile, link or load), 1 PA (Makefile), 1 MD (segments with mapped libraries), 2 PR (visible symbols). Transfer: "why does this library crash when the struct changes?"
- **Retrieval:** M10 (calling convention), M6 (Make), M1 (pipeline overview), M7 (layout).
- **Resources:** CS:APP 3e ch. 7 §7.1–7.12 (pp. 671–707); GNU Make 4.4.1 manual ch. 4 "Writing Rules", including §4.14 "Generating Prerequisites Automatically".
- **Success criteria:** SC1 (A), SC11 (A), SC9 (R).

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| Bundler ↔ compiler + linker | 11.1–11.2 | No runtime module registry; symbols are global unless `static` |
| `node_modules` ↔ libraries | 11.3 | No package manager and no semver at the ABI level |
| `import()` ↔ `dlopen` | 11.3 | Returns a `void*` you must cast; nothing checks the type |
| `.d.ts` ↔ header | 11.6 | A header is pasted in and can accidentally contain definitions |
| package.json `exports` ↔ symbol visibility | 11.6 | Visibility is a linker property, not a language one |

### M12. Memory Hierarchy & Performance (12.5 h, 2.5 weeks; browser simulator + [native] benchmarks)
**Why it matters:** it explains why the same Big-O can run about 17× slower (verified by the drafts). This audience already thinks in latency and caching from network waterfalls.

**Time:** lessons 4.2 h · project 6 h · variants 1 h · quiz + checkpoint 1.25 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 12.1 | Latency ladder (35) | Registers → L1/L2/L3 → DRAM → SSD; temporal and spatial locality | PR | DevTools-waterfall analogy |
| 12.2 | Caches (50) | Lines, sets, ways, tags; direct-mapped vs set-associative; LRU; address split with bit operations | SP (hit or miss), NP (tag/set/offset) | A19, V6 |
| 12.3 | Locality in loops (45) | Row vs column order: about 17–20× native, 4.6–7.1× wasm, 4.3× JS `Int32Array` | PR (direction and order of magnitude), run [both] | V6 |
| 12.4 | Data layout (40) | AoS vs SoA; pointer chasing (M8 lists) vs arrays; chaining vs probing (M9) | PR, CT | V6, V2 |
| 12.5 | Honest benchmarking (40) | Warm-up, median, `-O2`, sinks against dead-code elimination, variance; `perf stat` (Linux; limited on WSL) or Instruments (macOS) | FB (a flawed benchmark) | — |
| 12.6 | Blocking and compiler help (40) | Tiling for transpose and multiply; `-O` levels, inlining, vectorization, `restrict` | PR | V7 |

- **Project P12, cachesim + Make It Fast:**
  - (A) A trace-driven set-associative LRU simulator (`-s -E -b`, L/S/M records). Hits, misses and evictions must equal the reference on 8 (s, E, b, trace) combinations.
  - (B) A blocked transpose: correct, with misses under thresholds for 32×32 and 64×64 at s=5, E=1, b=5, **counted by the learner's own simulator** (cachelab-style parameters; confirm before shipping).
  - (C) At least 3× speedup over naive on the learner's own machine, plus a short report comparing V6 predictions with measurements.
- **Checkpoint:** 3 V6 predictions, 1 address split, 2 PR (performance *ordering*, from pipeline runs), 1 FB (benchmark), 1 assembly-loop read. Transfer CT: a loop interchange, measured.
- **Retrieval:** M11, M10 (memory operands), M3 (row-major), M8 and M9 (lists, probing).
- **Resources:** CS:APP 3e §6.2 "Locality" (p. 604) through §6.6 (p. 639); CMU 15-213 F15 Lecture 12 "Cache Memories" (readings 6.4–6.7).
- **Success criteria:** SC8 (A: caches, access patterns), SC6 (D), SC9 (D).

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| HTTP/CDN/memo cache ↔ CPU cache | 12.1–12.2 | Hardware-managed, 64 B lines, conflict misses, no invalidation API |
| TypedArray vs array of objects ↔ SoA vs AoS | 12.4 | Same lesson: contiguous data is fast, pointer chasing is slow |
| Layout thrashing ↔ cache thrashing | 12.3 | Loose analogy only |

### M13. The Operating System: Processes, System Calls, Files & Virtual Memory (15 h, 3 weeks, [native] POSIX; WSL on Windows)
**Why it matters:** Node's `fs` and `child_process` are thin wrappers over these calls, and every shell pipe the learner has typed is `fork`, `exec` and `dup2`. The browser has no `<sys/wait.h>` (verified by learner-first), so this module has to be native. In the browser, JS literally plays the kernel through WASI, which makes a good bridge.

**Time:** lessons 4.9 h · small tools 1.5 h · project 6 h · variants 1.25 h · quiz + checkpoint 1.25 h.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 13.1 | The syscall boundary (40) | User vs kernel mode, traps, libc wrappers, `errno`; WASI trace vs `strace` (`printf` → `write(1,…)`) | PR (number of `write` calls, tty vs pipe) | V8, A20 |
| 13.2 | File descriptors (45) | `open`/`read`/`write`/`close`/`lseek`; fds 0/1/2; stdio over syscalls; buffer sizes from 1 B to 64 KiB; stdout/stderr ordering under redirection | CT `mycat`/`mycp`, BENCH, PR [both] | V8 |
| 13.3 | `fork`/`exec`/`wait` (50) | Copy-on-write; `waitpid`, `WIFEXITED`/`WEXITSTATUS`; zombies and orphans; printf-before-fork duplication when piped | PR (output order), PA | A21, V3 |
| 13.4 | Pipes and redirection (45) | `pipe`, `dup2`; how `a | b > f` works; an unclosed pipe end hangs | CT, MD (fd table) | V4 fd-table mode |
| 13.5 | Signals and exit status (30) | SIGSEGV, SIGINT, SIGPIPE, SIGCHLD; exit code 128+n (139 for SIGSEGV); async-signal-safety | PR | — |
| 13.6 | Virtual memory (50) | Pages, page tables, TLB (a cache, from M12), faults, protection (why NULL faults natively but not in wasm); after `fork`, the same address holds different values in parent and child; `mmap`; `brk` vs `mmap`; `/proc/self/maps` / `vmmap` | PR, MD (translate an address) | A22, V6 address-split mode |
| 13.7 | Files and directories (35) | Inodes, `stat`, permissions, `opendir`/`readdir`; mini `ls -l` | CT | — |

- **Project P13, `msh`:** prompt loop; argument parsing; builtins `cd`, `exit` and `pwd`; `fork`+`execvp`+`waitpid`; `$?`; `<`, `>` and `>>`; one `|` (stretch: N stages); Ctrl-C kills the child, not the shell. The runner (scripted stdin) checks:
  - stdout, stderr, created files and exit codes against `/bin/sh`;
  - **a missing command prints an error and gives status 127**;
  - no zombies (via `ps`);
  - no leaked fds (`/proc/self/fd` on Linux, `lsof` on macOS);
  - ASan clean.
- **Checkpoint:** 2 PR (fork output), 1 MD (fd table after `pipe`/`dup2`), 1 virtual-memory translation, 2 CT (`run_pipeline(a, b)`), 1 CE (find the syscall and `errno` in an `strace` excerpt). Transfer: "why does output appear twice after `fork`?"
- **Retrieval:** M12 (TLB as a cache), M11 (loader), M7 (`FILE*`), M5 (layout), M6.
- **Resources:** OSTEP v1.10 ch. 5 "Process API" and ch. 39 "Files and Directories" (optional ch. 4, 13, 18, 19); CS:APP 3e ch. 10 "System-Level I/O" (p. 889) and §8.4 "Process Control" (p. 738).
- **Success criteria:** SC10 (A), SC2 (A: virtual memory), SC1 (A: load/exec), SC8 (D: TLB), SC11 (D).

| JS analogy | Lesson | Where it breaks down |
|---|---|---|
| `child_process.spawn` ↔ `fork`+`exec` | 13.3 | `fork` clones the whole process (memory and fds, copy-on-write); JS has no equivalent |
| Web Worker ↔ process | 13.3 | A Worker starts fresh; `fork` copies everything |
| `fs.openSync` fd ↔ kernel fd | 13.2 | Exact: libuv uses the same numbers |
| WASI in our runtime ↔ syscalls | 13.1 | Literally a syscall interface (`fd_write`) |
| Site-isolated tabs ↔ address spaces | 13.6 | The same pointer value in two processes is different memory |
| Stream backpressure ↔ pipes | 13.4 | Fixed kernel buffer; the writer blocks |
| `console.log` buffering ↔ `printf` | 13.3 | `fork` duplicates unflushed buffers |

---

## 6. Capstone: build `malloc`, then run your own programs on it (25 h, 5 weeks, [native])

**Track A (default).** Implement `mm_init`, `mm_malloc`, `mm_free`, `mm_realloc` and `mm_calloc` with 16-byte alignment. The heap comes from a provided `memlib`: `mem_sbrk` over one large `mmap` region, which works on macOS and Linux/WSL.

| Week | Milestone |
|---|---|
| 1 | Implicit free list, boundary tags, first fit, plus an `mm_check()` invariant checker |
| 2 | Coalescing (all four cases), splitting, in-place `realloc` |
| 3 | Explicit free list (LIFO, then address-ordered), then segregated lists |
| 4 | **Integration:** rebuild Speller (M9), `eventloop` (M8) and `msh` (M13) with `-include mm_shim.h`; `mm_dump()` JSON drives the V3 heap view |
| 5 | Benchmarking, tuning, and a report on utilization vs throughput |

**Test runner** (about 12 trace-driven runs: random, binary-tree, realloc-heavy, coalescing-adversarial, plus recorded Speller and eventloop traces):
- **Correctness:**
  - payloads 16-byte aligned; live blocks never overlap;
  - payload integrity checked by writing random patterns, including across `realloc`, which must preserve min(old, new) bytes;
  - `calloc` zeroes memory;
  - `mm_check` passes after every operation in debug builds;
  - UBSan clean; end-of-run accounting shows no live blocks.
- **Scores**, with thresholds calibrated against a staff allocator:
  - utilization (peak payload ÷ heap size) averages at least 70%;
  - throughput is at least 0.25× libc in the same run to pass, at least 0.5× for distinction (an implicit list fails, which pushes learners toward segregated lists).
- **Integration:** all three earlier programs give byte-identical output on `mm`.
- ASan can't see inside a custom heap, so the runner uses canaries plus `mm_check`. Valgrind client requests are an optional extra.

**Why it is harder than CS50 Speller:** raw byte pointer arithmetic, bit-packed headers (M2, M5), alignment (M7, M11), linked structures living inside untyped memory (M8), OS memory (M13), performance work (M12), and debugging without sanitizer coverage.

**Track B, Speller Pro** (same 25 h):
- Backends: chained hash with resize, open addressing, a compact trie, and a sorted-array baseline.
- A median-of-N `-O2` benchmark harness, byte-exact memory accounting, and a cache-reasoned choice backed by V6 or `perf`.
- Must be at least 2× faster than the baseline, ASan/Valgrind clean, and come with a report.

**Graduation Check** (60–90 min, gated certificate): draw a memory layout, diagnose errors by pipeline stage, read an assembly listing, predict a fork program's output, interpret an ASan report, and choose a data structure from constraints.

**Resources:** CS:APP 3e §9.9 "Dynamic Memory Allocation" (pp. 839–864, incl. §9.9.12, p. 854); K&R 2e §8.7 "Example—A Storage Allocator" (p. 185).

**JS analogy:** the V8 heap and GC. It breaks down because C cannot compact or move blocks: pointers are raw addresses.

---

## 7. Success criteria → module coverage
I = introduced, D = developed, **A** = assessed (project or checkpoint), R = retrieval only.

| Criterion | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | Cap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SC1 source → process | I | | | | | D | | | | D | **A** | | **A** | R |
| SC2 memory layout | | | | I | **A** | D | D | | | **A** | D | | **A** | D |
| SC3 pointers/arrays/strings/structs/heap | I | D | D | D | **A** | D | **A** | **A** | D | | | | | **A** |
| SC4 debugger + ASan/Valgrind | | | | | I | **A** | D | D | **A** | D | | | D | **A** |
| SC5 lists/stacks/queues/hash/BST/trie | | | | I | D | | | **A** | **A** | | D | | | D |
| SC6 Big-O, sort/search | | | | **A** | | | | D | **A** | | | D | | R |
| SC7 bin/hex/two's complement/float/endianness/bitwise | I | **A** | D | | D | | **A** | | D | D | | D | | D |
| SC8 CPU, registers, caches, access patterns | | | | | | | | | | **A** | | **A** | D | D |
| SC9 read asm from own C | | | | | | I | | | | **A** | D | D | | |
| SC10 syscalls, files/processes, OS | | | | | | | I | | | | | | **A** | D |
| SC11 multi-file, Make, headers, C ABI | | | | | | I | D | D | D | D | **A** | | D | **A** |
| CS50x W1–W5 | W1 | W1/W4 | W2 | W3 | W4 | W2/W4 | W4 | W5 | W5 | | | | | |

## 8. CS50x 2026 problem-set parity

| CS50 pset (2026) | CS50 requirement | Our equivalent | Module | At least as hard because… |
|---|---|---|---|---|
| Hello, World | complete | 1.1 CT | M1 | equal, plus clang vs gcc diagnostics |
| Hello, It's Me | submit | M1 problem set | M1 | adds validation |
| Mario less / more | one of | less as warm-up, **more required** (P1) | M1 | harder one required |
| Cash / Credit | one of | **both**: Cash (cents) and Credit (P2) | M1/M2 | both required; Credit must match on wasm32 and native |
| Scrabble | submit | M3 problem set | M3 | equal |
| Readability | submit | M3 problem set | M3 | plus C vs JS rounding |
| Caesar / Substitution | one of | **`cipher`: both, plus decrypt and a 200-string round-trip** (P3) | M3 | both, plus property tests |
| Wordle | not in 2026 (older editions) | optional extension | M3 | — |
| Sort | submit | identify binaries **plus implement all three plus a doubling table** | M4 | adds implementation and empirical Big-O |
| Plurality | submit | M4 problem set | M4 | equal |
| Runoff / Tideman | one of | **Tideman required** (P4); Runoff warm-up | M4 | harder one required, with a DFS lesson |
| Volume | submit | M7 problem set | M7 | clipping tests |
| Filter less / more | one of | **all five filters** plus a 4000×3000 heap test (P7) | M7 | union of both versions |
| Recover | submit | P7, synthetic card, SHA-256 checks | M7 | randomized data |
| Inheritance | submit | M8 problem set | M8 | 1000 seeded runs, leak-free |
| Speller | submit | P9 plus beating a `bsearch` baseline; then Libify (M11) and capstone integration or Track B | M9 | performance gate and ABI packaging |
| — | — | bitlab-lite, hexcolor, `libstr`, Bug Hunt, `eventloop`, word frequency, TinyCPU, Asm Detective, Libify, cachesim, `msh`, `malloc` | M2–Cap | beyond CS50 |

## 9. Visualizers

| ID | Name | Modules | Modes | Predict interaction |
|---|---|---|---|---|
| V1 | Number Playground | 1, 2, 3, 5, 10, 12 | binary, hex, two's-complement wheel, IEEE float/double editor, overflow wheel, JS `Number` comparison | NP conversions, PR on wrap and rounding |
| V2 | Byte Viewer | 2, 3, 5, 7, 11, 12 | live wasm memory; endianness; struct padding with wasm32/x86-64/arm64 toggle; hexdump with WAV/BMP/JPEG header overlays | MD on padding and bytes, PR on layout |
| V3 | Stack/Heap Stepper | 1 (teaser), 4, 5, 6, 8, 10, 13, Cap | frames, locals, heap blocks; precomputed traces; capstone `mm_dump` JSON | SP (next state) |
| V4 | Pointer Diagram | 5, 7, 8, 9, 13 | auto-drawn and drag-to-draw; list, tree, argv and fd-table modes | MD |
| V5 | Hash-Table Collision Visualizer | 9, 12, Cap B | hash function, bucket count, load factor, chaining, probing, tombstones, resize, trie, chain histogram | PR on bucket, probes, resize |
| V6 | Cache Simulator | 12, 13 | s/E/b, LRU, address trace from a C loop, hit/miss heat map, address-split mode for page translation | SP (hit or miss), NP (split) |
| V7 | Pipeline Explorer | 1, 6, 10, 11, 12 | **live** in-browser `-E/-S/-c/nm/link` for wasm32; static native x86-64/arm64 `.s`, `nm`, `objdump` panes from the build | PR ("which line produced this?"), CE |
| V8 | Syscall Tracer | 1 (teaser), 13 | WASI import log next to native `strace` | PR (count of `write` calls) |
| V9 | Algorithm Race | 4, 8, 9 | bars with comparison and swap counters, doubling chart, graph/DFS mode | TT, PR |
| V10 | TinyCPU / Register Stepper | 10, 12 | toy ISA plus scripted gdb/lldb `stepi` traces | SP on registers and flags |

## 10. HyperFrames animations (30–90 s each)

| ID | Module / lesson | Length | What it shows | Interaction that follows |
|---|---|---|---|---|
| A1 | M1 1.1 | 45 s | Press Run: C → in-browser clang → `.wasm` → Worker → output panel | PR: which messages came from the compiler and which from the program? |
| A2 | M6 6.2 (recap in M11 11.1) | 75 s | `hello.c` → preprocess → compile → assemble → link → load | CE: classify 3 failures by stage |
| A3 | M2 2.3 | 45 s | Two's-complement wheel; wrap vs UB | NP: place −1, INT_MIN and `(unsigned)-1`; PR `(unsigned char)250+10` |
| A4 | M2 2.5 | 60 s | Float fields: sign, exponent, mantissa | NP: decode `0x3F800000`; PR `16777217.0f` |
| A5 | M4 4.3 | 50 s | Frames pushed and popped during recursion | SP: next frame of `fact(3)` |
| A6 | M4 4.4 | 60 s | Merge sort split and merge | TT: next state of the merge buffer |
| A7 | M5 5.3 | 50 s | Swap by value vs by address | SP swap; FB broken swap |
| A8 | M5 5.5 | 60 s | Where variables live; heap growth; native vs wasm32 layout | MD: place 20 declarations |
| A9 | M6 6.1 | 45 s | Why the browser didn't crash: linear memory vs virtual memory with unmapped page 0 | PR [both]: what a NULL write does |
| A10 | M7 7.5 | 60 s | BMP anatomy: headers, BGR, bottom-up rows, 4-byte padding | MD: mark padding in a 3-pixel row (V2) |
| A11 | M7 7.6 | 60 s | Carving JPEGs from 512-byte blocks | TT: recovery state machine over 6 blocks |
| A12 | M8 8.3 | 50 s | Linked-list insert, delete and free with a temp pointer | MD: redraw arrows after a delete |
| A13 | M8 P8 intro | 60 s | The event loop as C structures: ring buffer, list, timer BST | PR: execution order of a 6-line script |
| A14 | M9 9.2 | 75 s | Hashing into buckets, chaining, resize and rehash | V5 PR: bucket of "cat" after growing from 8 to 16 |
| A15 | M10 10.1 | 60 s | Fetch–decode–execute | SP: next PC and register on TinyCPU |
| A16 | M10 10.6 | 60 s | Calling convention: register arguments, `call`/`ret`, frame | SP: rdi/x0 at callee entry |
| A17 | M11 11.2 | 75 s | Symbol resolution and relocation | Drag symbols to definitions (V7); CE |
| A18 | M11 11.4 | 75 s | exec → loader → dynamic linker → `main` | PR: what changes between two runs (ASLR) |
| A19 | M12 12.2 | 75 s | Cache lines and sets; row vs column order | V6 SP: hit or miss for the next 8 accesses |
| A20 | M13 13.1 | 60 s | `printf` → buffer → `write` syscall → kernel → terminal | PR: `write` calls on a tty vs a pipe |
| A21 | M13 13.3 | 60 s | `fork`/`exec`/`wait` and copy-on-write | PR: output lines of a fork tree |
| A22 | M13 13.6 | 90 s | Virtual → physical translation, page table, TLB | MD: translate an address (V6 split mode) |
| A23 | Capstone week 2 | 75 s | Free list split and coalesce with boundary tags | V3 SP: free list after `free(b)` |

## 11. YouTube segments (at most 2 per module, all CS50x 2026 / Fall 2025)

| ID | Lecture (video ID) | Segment | Topic | Module | Verification |
|---|---|---|---|---|---|
| Y1 | L1 `SlqjA04_dpk` | 02:19:42–02:29:40 | overflow, Boeing, Pac-Man, truncation, float imprecision | M2 | SRT cues checked; MP4 is 2:30:17 |
| Y2 | L4 `db0H0U13YsA` | 00:06:56–00:18:12 | hexadecimal | M2 | hex at 00:07:36 |
| Y3 | L2 `h5Gc1n8ZuU8` | 00:41:59–00:59:14 | clang, the four steps | M1 | assembling 00:42:32, preprocessing 00:50:07 |
| Y4 | L2 | 01:33:27–01:44:25 | strings in memory, NUL | M3 | NUL at 01:38:42 |
| Y5 | L3 `6Svu_ae5ebk` | 01:46:12–01:58:58 | merge sort | M4 | 01:46:12 |
| Y6 | L4 | 01:27:41–01:30:35 | Binky | M5 | 01:27:41 |
| Y7 | L4 | 01:40:00–01:49:30 | memory layout, heap/stack, overflow | M5 | heap at 01:40:40 |
| Y8 | L2 | 00:26:17–00:36:52 | debugger | M6 | 00:26:17 |
| Y9 | L4 | 01:14:07–01:26:47 | Valgrind, garbage values | M6 | 01:14:07 |
| Y10 | L4 | 02:02:35–02:19:00 | file I/O through JPEG signatures | M7 | boundaries from drafts; my `fopen` search found no caption match (spelling likely differs) |
| Y11 | L5 `PmAI76OGE_E` | **00:33:30–00:55:00** | linked lists | M8 | **corrected by −1 h** |
| Y12 | L5 | **01:22:00–01:38:00** | trees, BSTs | M8 | **corrected** |
| Y13 | L5 | **01:38:00–02:01:00** | hashing, hash tables, tries | M9 | **corrected** |

M10–M13 use animations instead of video.

## 12. Further study (outside scope)
- **Concurrency:** OSTEP ch. 26–33; CS:APP ch. 12; Beej ch. 39 "Multithreading" and ch. 40 "Atomics".
- **Networking:** CS:APP ch. 11.
- **Signals, nonlocal jumps and a full job-control shell:** CS:APP §8.5–8.6.
- **Virtual-memory internals:** OSTEP ch. 18–23; CS:APP §9.7–9.8. **File-system implementation:** OSTEP ch. 40–42.
- **Garbage collection:** CS:APP §9.10 (p. 865).
- **Processor design:** CS:APP ch. 4; Nand2Tetris Projects 1–5. **Building a VM and compiler:** Nand2Tetris Projects 7–11.
- **Deep optimization:** CS:APP ch. 5. **Floating-point assembly:** §3.11. **PIC, GOT and PLT:** §7.12.
- **Exploits and mitigations:** CS:APP §3.10.3–3.10.4.
- **Algorithms:** balanced trees, graph algorithms and DP: Erickson ch. 2–8; CLRS 4e (later chapter numbers not verified).
- **C23:** Effective C 2e (C23); Modern C (C23; HAL and Manning editions number chapters differently).
- **Unicode:** Beej ch. 26–27.
- **Tooling:** libFuzzer/AFL++, `clang-tidy`, `gcc -fanalyzer`, CMake. Also SIMD, embedded C, and Rust/C++ FFI.
- CS50 Weeks 6–10 (Python, SQL, web) are out of scope by design.

## 13. Total length
- **195 h = 39 weeks at 5 h/week (about 9 months).**
  - Part I (M1–M5, browser): 62.5 h.
  - Part II (M6–M9): 55 h. **CS50 C parity at 117.5 h, week 23.5.**
  - Part III (M10–M13): 52.5 h.
  - Capstone: 25 h.
- **Fast lane ≈ 186 h (≈37 weeks).** Skip bitlab-lite, the "implement all three sorts" extension, the Runoff warm-up, the TinyCPU problem set, cachesim part C, `ls-lite` and the leaderboards.
- I recommend 2 optional flex weeks.
- These hours are higher than all three drafts on purpose. They budget cachelab-, datalab- and malloclab-equivalents at realistic sizes.

## 14. Pipeline implications
- Browser compile flags: `-std=c17 -Wall -Wextra -pedantic -Wl,-z,stack-size=8388608`. Guardrail mode adds the UB trap; M5+ tests add `-include leakcheck.h`. Run programs in a separate Worker.
- Compare stdout and stderr separately. Normalize `%p`, PIDs, timings and fork interleavings.
- Store compiler-error items per compiler.
- macOS-specific prediction items (`long double`, `char` signedness, Mach-O) need a macOS CI runner, or must be avoided.
- Use gcc for sanitizers in CI.
- Generate the `eventloop` oracle by running JS in Node.
- Never take UB answers from the browser.

---

### Appendix A: `leakcheck.h` (verified on yowasp clang 22 wasm32 and gcc 13.3 x86-64; 2.9 KB)
```c
#ifndef LEAKCHECK_H
#define LEAKCHECK_H
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct lc_blk { struct lc_blk *next; size_t n; const char *file; int line; } lc_blk;
#define LC_HDR ((sizeof(lc_blk) + _Alignof(max_align_t) - 1) / _Alignof(max_align_t) * _Alignof(max_align_t))
#define LC_PAY(b) ((void *)((unsigned char *)(b) + LC_HDR))
#define LC_CANARY 0xFD
static lc_blk *lc_head; static int lc_errors;
static inline void lc_report(void) { size_t nb = 0, bytes = 0;
    for (lc_blk *b = lc_head; b; b = b->next) { nb++; bytes += b->n;
        fprintf(stderr, "LEAK: %zu bytes allocated at %s:%d never freed\n", b->n, b->file, b->line); }
    fprintf(stderr, "leakcheck: %zu block(s), %zu byte(s) leaked; %d heap error(s)\n", nb, bytes, lc_errors); }
static inline void *lc_malloc(size_t n, const char *f, int l) {
    static int init; if (!init) { init = 1; atexit(lc_report); }
    lc_blk *b = (malloc)(LC_HDR + n + 8); if (!b) return NULL;
    b->n = n; b->file = f; b->line = l; b->next = lc_head; lc_head = b;
    memset((unsigned char *)LC_PAY(b) + n, LC_CANARY, 8); return LC_PAY(b); }
static inline lc_blk *lc_find(void *p, int unlink) {
    for (lc_blk **pp = &lc_head; *pp; pp = &(*pp)->next)
        if (LC_PAY(*pp) == p) { lc_blk *b = *pp; if (unlink) *pp = b->next; return b; }
    return NULL; }
static inline void lc_free(void *p, const char *f, int l) { if (!p) return;
    lc_blk *b = lc_find(p, 1);
    if (!b) { fprintf(stderr, "INVALID FREE: %p at %s:%d (double free or not from malloc)\n", p, f, l); lc_errors++; return; }
    unsigned char *c = (unsigned char *)p + b->n;
    for (int i = 0; i < 8; i++) if (c[i] != LC_CANARY) {
        fprintf(stderr, "HEAP OVERFLOW: wrote past end of %zu-byte block from %s:%d (detected at %s:%d)\n", b->n, b->file, b->line, f, l);
        lc_errors++; break; }
    (free)(b); }
/* lc_calloc (overflow-checked, zeroing) and lc_realloc (copy min(old,new), INVALID REALLOC on unknown ptr) as in the file */
#define malloc(n) lc_malloc((n), __FILE__, __LINE__)
#define calloc(k, n) lc_calloc((k), (n), __FILE__, __LINE__)
#define realloc(p, n) lc_realloc((p), (n), __FILE__, __LINE__)
#define free(p) lc_free((p), __FILE__, __LINE__)
#endif
```
Build commands:
- Browser: `runClang(['clang','-std=c17','-Wall','-Wextra','-pedantic','-include','leakcheck.h','buggy.c','-o','prog.wasm'], files)`, run with `node:wasi` preview1.
- Native: `gcc -std=c17 -Wall -Wextra -pedantic -fsanitize=undefined -include leakcheck.h buggy.c`.

### Files
In `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/judge/`:
- `lc/leakcheck.h`, `lc/buggy.c`, `lc/buggy2.c`, `lc/build.mjs`, `lc/run.mjs`
- `mvhd.py`, `mp4/l1.tail`, `mp4/l4.tail`, `mp4/l5.tail`
- `web/lecture1–5.srt`, `web/pset1–5.html`, `web/beej.html`, `web/ostep.html`, `web/make.html`, `web/erickson.html`, `web/cmu15.html`, `web/preface3e.pdf`, `web/preface3e.txt`, `web/kr_sample.pdf`, `web/kr.txt`, `web/n2t.html`, `web/week5.html`

### Sources
- [CS50x 2026](https://cs50.harvard.edu/x/) and its [problem sets](https://cs50.harvard.edu/x/psets/)
- [Beej's Guide to C](https://beej.us/guide/bgc/html/split/index.html)
- [OSTEP](https://pages.cs.wisc.edu/~remzi/OSTEP/)
- [GNU Make manual](https://www.gnu.org/software/make/manual/html_node/index.html)
- [CS:APP 3e preface TOC](https://csapp.cs.cmu.edu/3e/pieces/preface3e.pdf)
- [CMU 15-213 F15 schedule](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f15/www/schedule.html)
- [Erickson, Algorithms](https://jeffe.cs.illinois.edu/teaching/algorithms/)
- [K&R 2e sample](https://www.ciscopress.com/content/images/9780131103627/samplepages/0131103628.pdf)
- [Nand2Tetris](https://www.nand2tetris.org/course)
- [CLRS 4e (PRH listing)](https://penguinrandomhouse.com/books/isbn/9780262046305)
- [Effective C 2e (PRH)](https://penguinrandomhouse.com/books/773711/effective-c-2nd-edition-by-robert-c-seacord) and [O'Reilly](https://oreilly.com/library/view/effective-c-2nd/9781098182496)