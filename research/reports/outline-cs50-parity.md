# CS50-Parity-First C Course Outline (C17 plus low-level topics)

Design angle: every CS50x Week 1–5 concept and problem set gets a clear equivalent that is at least as hard. The low-level material (data representation, toolchain, assembly, caches, OS, linking/ABI, allocator) is layered around that core.

---

## 0. What I verified and what I only read

### Verified by running it in this container
All scratch work is in `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/course-outline-cs50-parity/` (`cs50/`, `books/`, `verify/`).

1. **The current CS50x syllabus.** `curl` reaches cs50.harvard.edu from the shell, but the WebFetch tool cannot resolve it. The page title is "CS50x 2026" and the pset deadline is 2027-06-30T23:59 UTC. Required problems:
   - PS1: Hello, World (practice only); submit Hello, It's Me; Mario (less **or** more); Cash **or** Credit.
   - PS2: Scrabble; Readability; Caesar **or** Substitution. **Wordle is not in the 2026 set.**
   - PS3: Sort; Plurality; Runoff **or** Tideman. The page calls Tideman "optional but challenging".
   - PS4: Volume; Filter (less **or** more); Recover.
   - PS5: Inheritance; Speller.
2. **Spec details I rely on:**
   - Mario re-prompts for 1–8 and the gap is two hashes wide.
   - Cash uses quarters, dimes, nickels and pennies, input in cents.
   - Credit: AmEx is 15 digits starting 34/37; MasterCard is 16 digits starting 51–55; Visa is 13 or 16 digits starting 4.
   - Readability uses Coleman-Liau `0.0588*L - 0.296*S - 15.8` and prints "Before Grade 1" or "Grade 16+".
   - Sort asks you to identify sort1, sort2 and sort3 as selection, bubble or merge.
   - Volume: 44-byte header, int16 samples.
   - Filter less = grayscale, sepia, reflect, blur. Filter more = grayscale, reflect, blur, edges.
   - Recover: 512-byte blocks, signature `0xff 0xd8 0xff 0xe?`, files named `###.jpg`, 50 JPEGs in the image.
   - Inheritance: `create_family` uses malloc and the oldest generation has NULL parents.
   - Speller: 143,091-word dictionary, `LENGTH` 45, `check` is case-insensitive, no leaks allowed, timings reported as "TIME IN load/check/size/unload".
3. **Lecture topics per week** come from the official notes headings (`/x/notes/1..5/`). Week 1 covers overflow, truncation and floating-point imprecision. Week 2 covers debugging, compiling, arrays, strings, argv and exit status. Week 3 covers searches, running time, structs, selection, bubble, recursion and merge sort. Week 4 covers hex, pointers, pointer arithmetic, malloc, Valgrind, garbage values, Binky, swap, overflow, scanf and file I/O. Week 5 covers queues, stacks, resizing arrays, linked lists, trees, hashing and tries.
4. **Video timestamps.** I took them from the official English SRT files (`https://cdn.cs50.net/2025/fall/lectures/N/lang/en/lectureN.srt`). These are the Fall 2025 lectures that the CS50x 2026 week pages use. The YouTube IDs come from the same week pages: W1 `SlqjA04_dpk`, W2 `h5Gc1n8ZuU8`, W3 `6Svu_ae5ebk`, W4 `db0H0U13YsA`, W5 `PmAI76OGE_E`. **Caveat:** youtube.com is blocked here, so I could not check whether the YouTube player is offset from the SRT/MP4.
5. **Licences.** CS50x material is **CC BY-NC-SA 4.0** (from `/x/license/`). libcs50 is **GPL-3.0** (its LICENSE file on raw.githubusercontent). So we write original specs, original distribution code and our own helper header (§1.8).
6. **Book tables of contents, checked at the source:**
   - OSTEP chapter numbers from `pages.cs.wisc.edu/~remzi/OSTEP/`.
   - Beej's Guide to C **v0.11.0** (dated Sep 26 2026) chapter list.
   - K&R 2e full TOC from the Cisco Press sample PDF.
   - CS:APP 3e chapter titles from the Pearson product page. Section ranges from the CMU 15-213 schedule: 2.1–2.3, 3.1–3.11, 6.1–6.3, 6.4–6.7, 7, 8.1–8.4, 8.5–8.8, 9.1–9.8, 9.9, 9.10–9.12, 10. "§2.4 Floating Point" is backed up by course slides that cite "CSAPP 2.4".
   - *Modern C*: the free HAL edition (hal-02383654v2, Oct 15 2024) is **C23**. Manning's print edition (ISBN 9781633437777) came out Sep 1 2025, and the author warns "notable differences in numbering". Chapter 11 is "Pointers", 12 "The C memory model", 13 "Storage".
   - *Effective C* 2nd ed (No Starch, 2024) is **C23**. Chapters 1–11, e.g. Ch. 6 "Dynamically Allocated Memory", Ch. 11 "Debugging, Testing, and Analysis".
   - Nand2Tetris Projects 1–12, e.g. P4 "Machine Language", P5 "Computer Architecture".
7. **Type sizes per target** (clang 18 `-dM -E`):

   | target | long | ptr/size_t | long double | char |
   |---|---|---|---|---|
   | x86_64-linux | 8 | 8 | 16 (64-bit mantissa) | signed |
   | **wasm32-wasi** | **4** | **4** | 16 (113-bit mantissa) | signed |
   | arm64-apple-macos | 8 | 8 | **8** | signed |
   | **aarch64-linux** (WSL on ARM laptops) | 8 | 8 | 16 | **unsigned** |

8. **Struct layout, x86-64 vs wasm32** (symbol sizes via `llvm-nm`):

   | struct | x86-64 | wasm32 |
   |---|---|---|
   | `{char; long; char}` | size 24, align 8, `offsetof(l)=8` | size 12, align 4, `offsetof(l)=4` |
   | `{char; double}` | 16 | 16 |
   | `{int; struct node *next}` | 16 | 8 |
   | `{long; char; char}` | 16 | 8 |

9. **Sanitizers and Valgrind:**
   - gcc 13.3 with `-fsanitize=address,undefined` caught heap-buffer-overflow, heap-use-after-free, a LeakSanitizer 32-byte leak, a UBSan signed overflow (`2147483647 + 2 cannot be represented in type 'int'`), an array index out of bounds, and a stack-buffer-overflow.
   - **clang 18 in this container cannot link ASan**: `libclang_rt.asan-x86_64.a` is missing. The CI pipeline needs to use gcc for sanitizers or install compiler-rt.
   - Valgrind 3.22 reported "32 bytes … definitely lost" and "Invalid write of size 4".
10. **Real diagnostics for the "interpret the error" exercises:**
    - gcc 13 only *warns* `implicit declaration of function 'strlen'`. clang 18 *errors*: `call to undeclared library function 'strlen' … ISO C99 and later do not support implicit function declarations`.
    - Both compilers report `-Wformat` mismatches and `-Wparentheses` for `if (n = 3)`.
    - `double avg = 7 / 2;` gets **no warning** from either compiler, which makes it a good predict item.
    - gcc gives `-Warray-compare` on `a == b`.
    - `0b101` under `-std=c17 -pedantic` warns on both (gcc: "binary constants are a C2X feature or GCC extension"; clang: `-Wgnu-binary-literal`).
    - Without `-lm`, gcc 13 / glibc 2.39 fails with `undefined reference to 'round'`.
11. **C vs JS outputs** (native gcc vs node):

    | expression | C | JS |
    |---|---|---|
    | `0.1 + 0.2` | `0.30000000000000004` | `0.30000000000000004` (same) |
    | `7 / 2` | `3` | `3.5` |
    | `(unsigned)-1` | `4294967295` | `-1 >>> 0` gives the same |
    | `float f = 16777217` | `16777216.0` | `Math.fround` gives the same |
    | `-7 / 2`, `-7 % 2` | `-3`, `-1` | same |
    | `-7 >> 1` | `-4` (implementation-defined in C) | `-4` |
    | `round(-2.5)` | `-3.0` | `Math.round(-2.5)` = `-2` |
    | `strlen("héllo")` | `6` | `.length` = `5` |
    | `"👍🏽"` | — | `.length` 4, 2 code points, 8 UTF-8 bytes |
    | `-1 < 0u` | `0` | — |
    | `uint32_t 0x01020304` bytes | `04 03 02 01` (little-endian) | — |

12. **Memory layout ordering** (two runs, x86-64 Linux): code < literal < globals/bss < heap < stack. The ordering was the same both times; the actual values changed (ASLR).
13. **fork and stdio buffering:** `printf("hello "); fork();` with output piped prints `hello child` / `hello parent`, so the buffered text appears twice.
14. **Cross-ISA assembly from one Linux machine** (clang 18 `-O1 -S`, header-free code):
    - `int add(int,int)` gives `leal (%rdi,%rsi), %eax; retq` on x86-64, `add w0, w1, w0; ret` on arm64-apple, and `local.get 1; local.get 0; i32.add` on wasm32.
    - The array-sum loop gives `movslq (%rdi,%rcx,4)` on x86-64 vs `ldrsw x9, [x0], #4` on arm64.
15. **Course helper header.** A ~25-line `get_int` (`fgets`+`strtol`, re-prompts) plus a Mario-more solution matched the CS50 spec. Fed `-1, 0, abc, "", 42x, 99999999999, 9, 4`, it re-prompted 7 times and then printed the 4-row double pyramid (code in Appendix A).

### Read in docs or known, but not verified here (check on real machines)
- Valgrind does not run on Apple Silicon macOS. The plan is to use `leaks --atExit -- ./prog` plus ASan there.
- LeakSanitizer support in Apple clang on arm64 is limited.
- gdb is unavailable on Apple Silicon, so Mac learners use lldb.
- `perf` may not work in WSL2.
- `dtruss` needs SIP changes.
- GNU ld cares about library order and macOS ld64 does not.
- CS:APP section titles inside chapters (e.g. "9.11 Common Memory-Related Bugs in C Programs") are from memory; the 15-213 schedule only confirms the ranges.
- CS:APP cachelab parameters (s=5, E=1, b=5; 32×32 and 64×64 transpose).
- In-browser toolchain behaviour and HyperFrames rendering were outside this task.

---

## 1. Global design (applies to every module)

### 1.1 The parity rule
For each CS50 "choose one" pair, **we require the harder one**: Mario-more, Credit, Substitution, Tideman, and Filter-more plus sepia (all five filters). The easier version becomes a scaffolded warm-up. Every CS50 lecture topic maps to a named lesson (concept checklist in §7). Where CS50 skips something its pset needs, we teach it instead of leaving it out. For example, Tideman needs DFS cycle detection, so §5.7 teaches it.

### 1.2 Lesson anatomy
A lesson is 3–6 cards. Each card is **at most ~250 words, or one animation, or one video segment**, followed by an interaction. Lessons take 40–70 minutes.

Interaction codes:
- **PRED**: predict before running. The answer is the stored native output from the build pipeline. Addresses are normalized, so we ask about relationships between addresses, never their values. **We never ask learners to predict the output of undefined behaviour**; we ask "what will the sanitizer report?" instead.
- **CODE**: write code that is checked by automated tests.
- **FIX**: fix a bug, starting from a symptom such as an output, a crash or a sanitizer report.
- **MEM**: fill in a memory diagram.
- **PAR**: Parsons problem (put the lines in order).
- **ERR**: interpret a real compiler, linker, sanitizer or Valgrind message.
- **TRACE**: step through a visualizer and predict the next state.
- **BENCH**: measure, then predict.
- **MCQ**: multiple choice or short answer.

### 1.3 Hints, solutions, variants
- **Three hint tiers:** T1 is a conceptual nudge, T2 points at the relevant line or concept, T3 gives pseudocode or partial code.
- **The solution unlocks** after at least 2 substantive attempts (a test run after a code change) **and** the T3 hint. Then a **variant exercise** (same skill, different surface) has to pass before the item counts as mastered.

### 1.4 Retrieval quiz at the start of each module
6–10 items, about 10 minutes, interleaved: roughly 50% from the previous module, 30% from 2–3 modules back, 20% from older modules. It includes PRED items with pipeline-generated answers. Module 1 starts with a JS/TS diagnostic instead, to calibrate the analogies.

### 1.5 Gated checkpoint at the end of each module
- Items come from a pool, so a retake uses different variants.
- Every checkpoint includes at least one item each of CODE, FIX, MEM or TRACE, ERR, and 4–6 PRED/MCQ.
- Passing requires **80% or more**, plus the module project passing its runner. That unlocks the next module.
- A failed attempt generates a review set targeted at the missed tags.

### 1.6 Where code runs
- **[B] in the browser** (wasm32): Modules 1–3 fully, plus short PRED snippets in later modules whenever the pipeline found no native-vs-wasm difference. When it did find one, the lesson shows the native output and explains the difference, or marks the snippet "native-only".
- **[L] local**: from Module 4 on, all projects, debugging, sanitizers and benchmarks.
- **[V] visualizer**: in the browser, always.

### 1.7 Visualizers and the build-time explorer
- **V1 Stack/Heap Stepper.** Modes: call-stack, array (searching/sorting traces with comparison and swap counters), registers. The learner predicts the next state.
- **V2 Pointer Diagram.** Box-and-arrow, editable for fill-ins. Modes: list, tree, argv, fd-table.
- **V3 Number Playground.** Binary, hex, two's complement, IEEE-754 single and double.
- **V4 Byte Viewer.** Endianness, struct padding (wasm32 vs x86-64 vs arm64 side by side, using the table in §0.8), and file hexdumps with header-field overlays for WAV, BMP and JPEG.
- **V5 Hash-Table Collision Visualizer.** Chaining, linear probing, tombstones, resizing, load factor; plus a trie mode.
- **V6 Cache Simulator.** Direct-mapped or set-associative, LRU; trace playback; tag/set/offset breakdown of each address.
- **X1 Build Explorer.** Not interactive: static panes generated at build time showing `-E`, `-S` (x86-64, arm64 and wasm32, as verified in §0.14), `nm` and `objdump` output.

### 1.8 Helper header and licence guard
We ship an MIT-licensed `learnc.h` (`get_int`, `get_line`) in place of GPL-3.0 libcs50. Strings are `char *` from day one; there is no `typedef char *string`. In Module 6, learners **rewrite `get_line` themselves using `realloc`**, so the helper is not a black box for long.

CS50's specs, check50 tests and distribution files (card.raw, the sort binaries, texts, dictionaries) are CC BY-NC-SA. We **write our own** specs and generate our own data:
- a synthetic card.raw built from CC0 images;
- public-domain Gutenberg texts;
- a permissively licensed word list (licence still to be checked).

Linking or embedding CS50 YouTube segments is fine.

### 1.9 Local test runner
- Each project's starter includes `make test`. It runs `check.py`, which uses only the Python 3 standard library (python3 ships with Xcode CLT and Ubuntu; not verified on macOS here).
- It compiles with `-std=c17 -Wall -Wextra -pedantic -Werror`, runs the I/O and unit tests, then repeats under `-fsanitize=address,undefined`. For leaks it uses LSan on Linux, `leaks --atExit` on macOS, and `valgrind --leak-check=full --error-exitcode=1` on WSL.
- It also runs a `clang-format --dry-run` style check that warns but does not fail (the equivalent of style50).
- The browser runner for Modules 1–3 feeds stdin cases and compares against the native reference output.

### 1.10 HyperFrames animations (30–90 s each)

| ID | Topic | Length |
|---|---|---|
| A1 | Press Run: source → compiler → wasm → browser | 45 s |
| A2 | Preprocess → compile → assemble → link | 75 s |
| A3 | Two's-complement odometer | 45 s |
| A4 | IEEE-754 sign / exponent / mantissa | 75 s |
| A5 | Stack frames growing and shrinking during recursion | 60 s |
| A6 | Merge sort: split and merge | 60 s |
| A7 | Swap by value vs swap by address | 50 s |
| A8 | Process memory map and the heap growing | 60 s |
| A9 | Carving JPEGs from 512-byte blocks | 60 s |
| A10 | Linked-list insert/delete pointer surgery | 50 s |
| A11 | Hashing into buckets, chaining, resize/rehash | 75 s |
| A12 | Fetch-decode-execute | 60 s |
| A13 | Cache lines: row-major vs column-major | 75 s |
| A14 | System call trap, fork/exec/wait | 90 s |
| A15 | Virtual memory, page tables, TLB | 90 s |
| A16 | exec → loader → dynamic linker → `main` | 75 s |
| A17 | Allocator split and coalesce with boundary tags | 75 s |

---

## 2. Course map

| # | Module | CS50 parity | Env | Hours | Weeks (5 h/wk) | Calendar wk |
|---|---|---|---|---|---|---|
| 1 | From JS to C: types, control flow, functions | W1 | B | 10 | 2 | 1–2 |
| 2 | Arrays, strings and the command line | W2 | B | 10 | 2 | 3–4 |
| 3 | Bits and bytes: data representation | (W4 hex) + low-level | B | 10 | 2 | 5–6 |
| 4 | Your toolchain: build, link, debug (local setup) | W2 compiling/debugging | L | 10 | 2 | 7–8 |
| 5 | Algorithms: search, sort, recursion, structs | W3 | L+B | 15 | 3 | 9–11 |
| 6 | Memory I: pointers, stack and heap | W4 (first half) | L+B | 15 | 3 | 12–14 |
| 7 | Memory II: files, binary formats, memory bugs | W4 (second half) | L | 15 | 3 | 15–17 |
| 8 | Data structures I: lists, stacks, queues, trees | W5 | L | 15 | 3 | 18–20 |
| 9 | Data structures II: hash tables, tries, Speller | W5 | L | 15 | 3 | 21–23 |
| 10 | Inside the CPU: instructions, registers, assembly | — | L+B | 10 | 2 | 24–25 |
| 11 | Memory hierarchy and performance | — | L+B | 10 | 2 | 26–27 |
| 12 | The OS: processes, syscalls, files, virtual memory (POSIX) | — | L | 15 | 3 | 28–30 |
| 13 | Linking, loading, libraries and the C ABI | — | L | 10 | 2 | 31–32 |
| C | Capstone: a memory allocator | — | L | 25 | 5 | 33–37 |
| | **Total** | | | **185 h** | **37 weeks** | |

**CS50 C-parity milestone:** the end of Module 9 (week 23, 105 h of parity material). Every Week 1–5 pset is matched by then, using the harder variants.

---

## 3. Modules

### Module 1: From JS to C: Types, Control Flow, Functions [B]
**Why it matters to this audience.** They already think in JS's single `number` type, hoisting and a forgiving runtime. C's fixed-width types, declare-before-use and silent truncation catch them out immediately. Building a mental model of compile errors is their first real skill gap.

**Time:** 10 h = 2 weeks (lessons 5 h, problem set 2 h, project 2.5 h, checkpoint 0.5 h).

**Lessons**
- **1.1 Hello, compiler.** `main`, `#include`, `printf`, `\n`, `return 0`; what "compile" means (A1).
  - Interactions: CODE hello world; ERR on a missing `;` and `}` with real gcc/clang messages; PRED on output with and without `\n`.
- **1.2 Types and format codes.** `int`, `long long`, `double`, `float`, `char`, `bool` (`<stdbool.h>`), `sizeof`; integer division; casts.
  - Interactions: PRED `7/2`, `7/2.0`, `(int)3.99`, and `double avg = 7/2` (silent; §0.10); ERR on the verified `-Wformat` warnings; CODE a temperature converter. Uses V3 (preview).
- **1.3 Input and conditionals.** `learnc.h get_int/get_line`; if/else-if; `switch`; `&& || !`; comparing chars ('y'/'Y', the agree.c idea).
  - Interactions: CODE the Hello-It's-Me equivalent (greets by name; empty name re-prompts); PAR a compare program.
- **1.4 Loops.** while, for, do-while (the re-prompt idiom); nested loops for grids.
  - Interactions: CODE left-aligned pyramid (Mario-less warm-up); PRED iteration counts; FIX "the pyramid has one extra row" (off-by-one).
- **1.5 Functions and scope.** Prototypes (no hoisting); parameters are copies; block scope; uninitialized locals hold garbage; replacing magic numbers with `#define`/`enum`; correctness, design and style.
  - Interactions: ERR on implicit declaration (gcc warns, clang errors; §0.10); PRED on shadowing; CODE refactor Mario into functions.
- **1.6 The limits of numbers.** Integer overflow, truncation, floating-point imprecision. `long` is **4 bytes in wasm32 and 8 natively** (§0.7), so use `long long`/`int64_t`.
  - Interactions: MCQ "what will UBSan report?" (signed overflow, using the real native report); PRED unsigned wraparound; CODE Cash (greedy) with a variant showing greedy fails for coins {1,3,4}. Uses V3.
  - Video: CS50x W1 lecture 02:19:42–02:27:30 (overflow, Boeing 787, Pac-Man, truncation, floating-point imprecision).

**Problem set (browser-tested):**
- Hello World.
- Hello, It's Me.
- **Mario-more** (exact spec: re-prompt outside 1–8, two-space gap).
- Cash.

**Project: Credit (Luhn).** It must classify AMEX, MASTERCARD, VISA or INVALID. The test runner checks:
- published test numbers: 378282246310005 and 371449635398431 (AMEX); 5555555555554444 and 5105105105105100 (MC); 4111111111111111, 4012888888881881 and 4222222222222 (13-digit VISA);
- invalid cases: Luhn-valid with a wrong prefix or length; Luhn-invalid; 10-digit numbers; non-numeric input re-prompts;
- **the program produces identical output under wasm32 and native.** This fails if the learner used `long`, which teaches the platform lesson;
- no warnings under `-Wall -Wextra -pedantic`.

**Checkpoint:** 6 PRED/MCQ (division, casts, scope, loop counts); 1 ERR (classify 3 real diagnostics); 1 CODE (new problem: ISBN-10 check digit with validated input); 1 FIX (a do-while re-prompt that accepts 0).

**Retrieval sources:** a JS diagnostic (`7/2`, `0.1+0.2`, `Number.MAX_SAFE_INTEGER`, hoisting, `typeof null`).

**Outside resources:**
1. Beej's Guide to C v0.11.0, Ch. 2 "Hello, World!", Ch. 3 "Variables and Statements", Ch. 4 "Functions".
2. K&R 2e Ch. 1 "A Tutorial Introduction" (§1.1–1.10) and §2.7 "Type Conversions".

**Success criteria covered:** SC7 (overflow/float intro), SC1 (what compiling is), CS50 W1.

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| `printf` ≈ `console.log` with template literals | 1.1–1.2 | Format specifiers must match the types (mismatch is UB; `-Wformat` catches it); no automatic stringification |
| `int`/`double` ≈ `number` | 1.2, 1.6 | JS has one double type; C truncates integer division, has fixed widths, and signed overflow is UB |
| `tsc` type errors ≈ compiler errors | 1.1, 1.5 | Many C bugs compile cleanly with only a warning, or none (`double avg = 7/2`) |
| `let` block scope ≈ C block scope | 1.5 | No TDZ and no `undefined`: an uninitialized local is garbage |
| function hoisting | 1.5 | C has none; you need a prototype before the call |
| `const` | 1.5 | C `const` means read-only through that name, not a compile-time constant; use `enum`/`#define` for sizes |

---

### Module 2: Arrays, Strings and the Command Line [B]
**Why it matters to this audience.** JS strings are immutable UTF-16 values with a `.length`. C strings are mutable, NUL-terminated byte arrays, and `==` compares addresses. Almost every early bug comes from this gap.

**Time:** 10 h = 2 weeks (lessons 5 h, problem set 2.5 h, project 2 h, checkpoint 0.5 h).

**Lessons**
- **2.1 Arrays.** Contiguous memory; no bounds checks; `sizeof arr / sizeof arr[0]`; passing the length separately; 2D arrays.
  - Interactions: PRED sizeof results; FIX "last score is garbage" (out of bounds); CODE average and max. Uses V4 (array bytes).
- **2.2 Strings are char arrays.** `'\0'`, literals, `strlen` is O(n), ASCII. **`strlen("héllo")` is 6 bytes while JS `.length` is 5** (§0.11).
  - Interactions: MEM draw "cat\0"; PRED. Uses V4.
  - Video: CS50x W2 lecture 01:33:27–01:44:25 (strings in memory).
- **2.3 `<ctype.h>` and `<string.h>`.** `toupper`, `isalpha`, `strcmp`.
  - Interactions: PRED `a == b` gives 0 while `strcmp` says equal (gcc `-Warray-compare`, verified); CODE Scrabble.
- **2.4 Text statistics and rounding.** Counting letters, words and sentences; `round` (half away from zero: **C `round(-2.5)` is -3, JS `Math.round(-2.5)` is -2**).
  - Interactions: PRED rounding; CODE Readability.
- **2.5 Command-line arguments and exit status.** `argc/argv`, `strtol` vs `atoi`, validation, `return 1`.
  - Interactions: FIX the segfault when `argv[1]` is missing; CODE Caesar; ERR the browser runner showing exit status 1.
- **2.6 What `make` does.** A short preview of the pipeline (A2 teaser; covered properly in M4).
  - Interactions: optional Wordle-style CODE problem (CS50x 2022 era; not in 2026).

**Problem set:** Scrabble; Readability; Caesar.

**Project: `cipher`, one CLI for both ciphers.**
- `cipher caesar <k>`, `cipher sub <KEY>`, and `-d` to decrypt.
- This is harder than Caesar plus Substitution separately.
- The test runner checks:
  - usage message and exit 1 for a missing or extra argument;
  - Caesar: non-numeric k rejected; k > 26 wraps;
  - Substitution key validation: exactly 26 characters, alphabetic only, no duplicates (case-insensitive);
  - case preserved and non-letters passed through;
  - **decrypt(encrypt(x)) == x on 200 random strings**;
  - exit 0 on success.

**Checkpoint:** CODE (new problem: Vigenère); FIX (missing NUL gives garbage tail); MEM (array + NUL); 5 PRED (sizeof vs strlen, `strcmp`, `argv[0]`); ERR.

**Retrieval sources:** M1 (integer division, format codes, do-while, scope).

**Outside resources:**
1. Beej Ch. 6 "Arrays", Ch. 7 "Strings", Ch. 18 "The Outside Environment".
2. K&R 2e §5.10 "Command-line Arguments".

**Success criteria covered:** SC3 (arrays/strings, partial), CS50 W2.

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| Array ≈ JS array | 2.1 | Fixed size, no `.length`, no bounds check; decays to a pointer; cannot be assigned or returned |
| String ≈ JS string | 2.2–2.3 | Mutable bytes ending in `\0`; UTF-8 bytes, not UTF-16 units; `==` compares addresses |
| `process.argv` ≈ `argv` | 2.5 | In C, `argv[0]` is the program; in Node, `argv[0]` is node and `argv[1]` is the script |
| `charCodeAt` ≈ chars are ints | 2.3 | `char` signedness varies by platform (more in M3) |
| `Math.round` ≈ `round` | 2.4 | They round negative halves differently |

---

### Module 3: Bits and Bytes: How Data Is Represented [B]
**Why it matters to this audience.** This is the "gaps in data representation" item from the brief. Hex and binary underpin pointers, file formats, hashing and assembly. The audience also already meets bit flags in React lanes, TypedArrays and DataView.

**Time:** 10 h = 2 weeks (lessons 5.5 h, problem set 1.5 h, project 2.5 h, checkpoint 0.5 h).

**Lessons**
- **3.1 Binary and hex.** Place value; one nibble per hex digit; `%x`/`%o`; `0b` is not C17 (the verified pedantic warning).
  - Interactions: V3 conversion drills; ERR on the `0b101` warning.
  - Video: CS50x W4 lecture 00:06:56–00:18:12 (hexadecimal).
- **3.2 Unsigned and two's complement.** `<limits.h>`, `<stdint.h>`; unsigned wraparound is defined, signed overflow is UB; signed/unsigned conversion (`(unsigned)-1`, `-1 < 0u` is 0).
  - Interactions: PRED (verified values); V3; A3.
- **3.3 Bitwise operators.** `& | ^ ~ << >>`; masks to set, clear, toggle and test; shifting by the type width or more is UB; right-shifting a negative is implementation-defined.
  - Interactions: CODE permission flags, popcount, is-power-of-two; FIX `1 << 31` on an int (use `1u`).
- **3.4 Floating point.** IEEE-754 fields, bias, NaN/Inf; `0.1+0.2` (identical to JS); `16777217f` becomes 16777216; epsilon comparisons; reading a float's bits with `memcpy` into `uint32_t` (no pointer-cast aliasing).
  - Interactions: V3 IEEE mode; A4; PRED.
- **3.5 Bytes in memory.** `sizeof` per platform (the §0.7 table, including wasm32 `long` = 4 and aarch64-Linux `char` unsigned); little-endian; alignment and padding (the §0.8 table); `offsetof`.
  - Interactions: V4 endianness and padding modes; MEM fill in the padding bytes; PRED struct sizes per target.
- **3.6 Text encodings.** ASCII; UTF-8 encoding rules; UTF-16 surrogates; why `"👍🏽".length` is 4.
  - Interactions: CODE encode one code point.

**Problem set:**
- print any integer in binary;
- float inspector (sign, exponent, mantissa);
- endianness probe;
- 64-flag bitset in `uint64_t`;
- parse a CSS `#RRGGBB` color into a `uint32_t` and back.

**Project: `utf8` tool.**
- Subcommands: `utf8 encode U+1F600` → `F0 9F 98 80`; `utf8 decode "F0 9F 98 80"`; `utf8 count <text>` prints bytes, code points and UTF-16 units. Hex-text input keeps it browser-safe.
- The test runner checks:
  - correct output for 1-, 2-, 3- and 4-byte sequences;
  - rejection of overlong encodings (`C0 80`), surrogates (`ED A0 80`), values above U+10FFFF (`F4 90 80 80`), truncated sequences and stray continuation bytes;
  - `👍🏽` counts as 8 bytes, 2 code points, 4 UTF-16 units;
  - clean under UBSan (no signed shifts).

**Checkpoint:** 5 V3 conversions; PRED (conversions, shifts, float equality); MEM (little-endian int + padded struct); CODE (new problem: RGB565 pack/unpack); FIX (UB shift).

**Retrieval sources:** M1 (overflow, types); M2 (chars are numbers, strings are bytes).

**Outside resources:**
1. CS:APP 3e Ch. 2 "Representing and Manipulating Information", §2.1–2.4.
2. Beej Ch. 24 "Bitwise Operations" and Ch. 37 "Fixed Width Integer Types".

**Success criteria covered:** SC7 (primary), SC2 (bytes and alignment, partial).

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| JS bitwise ops | 3.3 | JS converts to int32 and back to double (`>>>` for unsigned); C has many widths and unsigned types, and over-shifting is UB |
| React lanes / fiber flags | 3.3 | Same idea, but C flags can be 64-bit, unsigned, and `static_assert`-checked |
| `0.1+0.2` | 3.4 | Identical: both are IEEE doubles. C also has `float` (24-bit mantissa) and a `long double` whose size depends on the platform |
| DataView `getUint32(o, littleEndian)` | 3.5 | C uses the machine's byte order implicitly, with no bounds checks |
| `BigInt` | 3.2 | C has nothing built in; `uint64_t` is the ceiling |
| TextEncoder / `.length` | 3.6 | C strings are UTF-8 bytes; there are no code-unit semantics |

---

### Module 4: Your Toolchain: Build, Link, Debug (local setup) [L]
**Why it matters to this audience.** Their builds have always been hidden behind bundlers. Here they get a real local toolchain, learn to read which stage failed, and get a debugger that works like DevTools. This module also covers the CS50 Week 2 topics "Compiling" and "Debugging".

**Time:** 10 h = 2 weeks (lessons 5.5 h including install, project 3.5 h, checkpoint 1 h).

**Lessons**
- **4.1 Install and verify.**
  - macOS: `xcode-select --install` (clang, lldb, make).
  - Windows: `wsl --install`, then `sudo apt install build-essential gdb valgrind`, plus VS Code with the WSL extension.
  - The course `doctor.sh` prints `uname -m`, the compiler version and `sizeof` values, compiles hello with the strict flags, and runs an ASan sample. Learners paste its output into the browser, which checks it.
  - Calls out Apple Silicon = arm64 and Windows-on-ARM = aarch64 (unsigned `char`!).
- **4.2 The four stages.** `-E`, `-S`, `-c`, linking; `nm` on objects; `-lm`.
  - Interactions: X1 panes; A2; PRED "about how many lines does `-E` produce for hello.c?"; ERR on the verified `undefined reference to 'round'` (macOS needs no `-lm`).
  - Video: CS50x W2 lecture 00:41:59–00:59:14 (clang, linking, preprocessing, assembly, assembling, linking, decompiling).
- **4.3 Multi-file programs.** Declaration vs definition, include guards, `extern`, `static` functions, the one-definition rule.
  - Interactions: ERR "multiple definition" (definition in a header) and "undefined reference" (forgot to build a .c); PAR a header.
- **4.4 Make.** Targets, prerequisites, recipes (TAB), `CC`/`CFLAGS`, pattern rules, `.PHONY`, incremental builds.
  - Interactions: PRED "after `touch cipher.h`, what rebuilds?"
- **4.5 Debugger.** gdb and lldb side-by-side table (`break`, `run`, `next`, `step`, `finish`, `print`, `watch`, `bt`, `frame`); `-g -O0`.
  - Interactions: FIX a Readability word-count off-by-one using only the debugger; MCQ "value of `i` at the 3rd hit?" (answer from a native run).
  - Video: CS50x W2 lecture 00:26:17–00:36:52 (debugger).
- **4.6 Warnings and sanitizers as seatbelts.** `-Werror`; `-fsanitize=address,undefined`; reading ASan output; per-platform leak tooling (§1.9).
  - Interactions: ERR on the verified ASan and UBSan reports.

**Project: "Make it real".**
- Restructure the M2 cipher into `libcipher` (.c/.h) + `main.c` + `test_cipher.c` (assert-based) + a Makefile with `all`, `test`, `asan` and `clean` targets.
- The test runner checks:
  - zero warnings under `-Werror`;
  - `make test` passes and `make asan && make test` passes under the sanitizers;
  - `make clean` leaves no build artifacts;
  - include guards are present;
  - **no function definitions in headers**: `nm` shows each symbol defined in exactly one object;
  - an incremental build recompiles only the changed object (timestamps checked).

**Checkpoint:** ERR (classify 3 failures by stage: preprocessor, compiler or linker); PRED (Make rebuild set); CODE (repair a broken 3-file project); a debugger task (report a variable's value at iteration k).

**Retrieval sources:** M1 to M3 (format codes, strings, two's complement, sizeof per platform).

**Outside resources:**
1. Beej Ch. 17 "Multifile Projects" and Ch. 19 "The C Preprocessor".
2. K&R 2e §4.5 "Header Files", §4.6 "Static Variables".

**Success criteria covered:** SC1 (primary: preprocess, compile, assemble, link), SC4 (debugger and sanitizers introduced), SC11 (Make and headers).

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| npm scripts ≈ Makefile | 4.4 | Make is a timestamp-driven dependency graph with TAB-sensitive recipes |
| ES `import`/`export` ≈ headers + `extern`/`static` | 4.3 | `#include` is a textual paste; there is no module system and every symbol is global unless `static` |
| bundler ≈ linker | 4.2 | Resolves symbols across machine-code objects; no tree-shaking of individual functions inside one object |
| DevTools Sources panel ≈ gdb/lldb | 4.5 | Needs `-g`; optimized code confuses stepping; no live editing |
| source maps ≈ DWARF | 4.5 | Similar purpose |

---

### Module 5: Algorithms: Searching, Sorting, Recursion, Structs [L+B]
**Why it matters to this audience.** They call `.sort()` and `.indexOf()` without thinking about cost. CS50's Week 3 rigor (Big-O, Ω, Θ, recursion, merge sort) plus Tideman's graph reasoning is where parity is hardest to earn.

**Time:** 15 h = 3 weeks (lessons 6.5 h, problem set 3 h, project 4.5 h, checkpoint 1 h).

**Lessons**
- **5.1 Running time.** Counting steps; O, Ω, Θ; empirical doubling experiments.
  - Interactions: BENCH timing as N doubles; PRED growth-rate ranking.
- **5.2 Linear and binary search.** Iterative and recursive versions, loop invariants, `bsearch`.
  - Interactions: FIX an infinite loop and `mid=(lo+hi)/2` overflow (back to M3); V1 array mode.
- **5.3 Structs and typedef.** Arrays of structs (phonebook); designated initializers; **value semantics**.
  - Interactions: PRED "mutate a copy, print the original"; MEM.
- **5.4 Selection and bubble sort.** Counting comparisons and swaps; bubble's early exit gives Ω(n).
  - Interactions: V1 array mode; PAR.
- **5.5 Recursion and the call stack.** Base and recursive cases; frames; stack overflow ends in a segfault, not a RangeError.
  - Interactions: A5; V1 call-stack mode (TRACE the next frame).
- **5.6 Merge sort and `qsort`.** Merge buffer, O(n log n), stability; comparator functions (function pointers, `void *` preview).
  - Interactions: A6; CODE.
  - Video: CS50x W3 lecture 01:46:12–01:58:58 (merge sort pseudocode through the three-way visual comparison).
- **5.7 Graphs for elections.** Adjacency matrix; DFS cycle detection; ranked-pairs intuition.
  - Interactions: TRACE DFS on V1; CODE `creates_cycle()`.

**Problem set:**
- **Sort, extended.** Identify three black-box sort binaries by timing on sorted, reversed and random inputs (we build our own binaries per platform in CI). Also **implement all three** sorts and submit a doubling-experiment table that matches the Big-O claims.
- Plurality.
- Runoff (optional warm-up).

**Project: Tideman (ranked pairs).** Original distribution code with the same function decomposition. The test runner unit-tests each function:
- `vote` rejects unknown names and records ranks;
- `record_preferences`;
- `add_pairs` excludes ties;
- `sort_pairs` orders by strength, descending;
- `lock_pairs` skips cycle-creating edges, handles multiple cycles, and locks the final pair when it is safe;
- `print_winner`;
- plus whole-election I/O tests and a 9-candidate × 1000-voter performance limit.

**Checkpoint:** 4 Big-O classifications; PRED (struct copy, recursion print order); MEM (stack at depth 3); CODE (new problem: count inversions via merge sort); FIX (binary-search bug).

**Retrieval sources:** M2 (`strcmp`, arrays), M3 (overflow in the midpoint), M4 (Make, debugger).

**Outside resources:**
1. K&R 2e §4.10 "Recursion" and §6.1–6.4 (structures).
2. The CS50x W3 segment above.

**Success criteria covered:** SC6 (primary), SC3 (structs), CS50 W3.

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| `Array.prototype.sort(cmp)` ≈ `qsort(cmp)` | 5.6 | V8's sort is stable (TimSort); `qsort` makes no stability guarantee, and the comparator takes `const void *` |
| Object ≈ struct | 5.3 | Fixed layout, no dynamic keys; **assignment and argument passing copy the whole struct** |
| "Maximum call stack size exceeded" ≈ stack overflow | 5.5 | C gives SIGSEGV, not a catchable exception |
| `indexOf` vs binary search | 5.2 | Same idea |

---

### Module 6: Memory I: Pointers, Stack and Heap [L+B]
**Why it matters to this audience.** They have "never managed memory". A garbage collector has hidden addresses, lifetimes and ownership from them. This module is the conceptual core of the course.

**Time:** 15 h = 3 weeks (lessons 7 h, project 6 h, checkpoint 1 h, quiz 1 h).

**Lessons**
- **6.1 Addresses and pointers.** `&`, `*`, pointer types, `NULL`, `%p`.
  - Interactions: V2; MEM; PRED on address *relationships*.
  - Video: CS50x W4 lecture 01:27:41–01:30:35 (Pointer Fun with Binky).
- **6.2 Pass by pointer.** swap; out-parameters (`scanf` needs `&`); returning several values.
  - Interactions: A7; V1 TRACE swap; FIX a broken swap.
- **6.3 Pointer arithmetic and arrays.** `a[i] ≡ *(a+i)`; decay; `sizeof` inside functions; string literals live in read-only memory, so writing to one segfaults.
  - Interactions: PRED; MEM.
- **6.4 Memory layout and lifetimes.** text, rodata, data/bss, heap, stack; automatic, static and allocated lifetimes; a "where does it live?" drill over 20 declarations; dangling pointers to locals (gcc `-Wreturn-local-addr`, ASan stack-use-after-return).
  - Interactions: A8; V1; PRED ordering (verified: stack > heap > globals > code on x86-64 Linux).
  - Video: CS50x W4 lecture 01:40:00–01:49:30 (machine code, globals, heap, stack, overflow).
- **6.5 `malloc`, `calloc`, `realloc`, `free`.** The `sizeof *p` idiom, NULL checks, ownership, double free, use-after-free, leaks.
  - Interactions: ERR on real ASan and Valgrind reports; CODE `str_dup`; **CODE: rewrite `learnc.h get_line` using doubling `realloc`.**
- **6.6 Pointers to pointers.** The `argv` layout; dynamic 2D arrays; `char **split(...)`.
  - Interactions: V2 argv mode; MEM.
- **6.7 Overflows and safe input.** `gets` was removed in C11; `%s` overflow; `fgets`/`snprintf`; "stack smashing detected".
  - Interactions: FIX.

**Project: `libstr`, allocating string utilities written by hand.**
- Functions: `str_dup`, `str_concat`, `str_split`, `str_join`, `str_trim`, `str_replace_all`, `strv_free`.
- The test runner checks:
  - unit tests, including empty strings and separators at the edges;
  - 1000 randomized property tests against a reference;
  - clean under ASan+UBSan; zero leaks (LSan, `leaks` or Valgrind);
  - `nm` shows no forbidden library allocators (`strdup`, `strndup`).

**Checkpoint:** MEM ×2 (stack and heap after code runs); 5 PRED (arithmetic, decay); ERR (name the bug type and line from an ASan report); FIX (leak + use-after-free); CODE (new problem: reverse the words in place using only pointers).

**Retrieval sources:** M3 (hex, sizeof per platform), M5 (struct value semantics), M2 (NUL).

**Outside resources:**
1. K&R 2e Ch. 5 "Pointers and Arrays", §5.1–5.6.
2. OSTEP Ch. 14 "Memory API".

**Success criteria covered:** SC2 (primary), SC3 (primary), SC4 (ASan/Valgrind practice), CS50 W4.

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| Object references ≈ pointers | 6.1 | Pointers are numbers you can do arithmetic on; they can dangle or be uninitialized; you can take the address of any variable, including ints |
| JS "call by sharing" ≈ passing pointers | 6.2 | swap of two ints is impossible in JS and trivial in C |
| GC ≈ `free` | 6.5 | You are the garbage collector: leaks, double frees and use-after-free are your bugs |
| `null` TypeError ≈ NULL dereference | 6.1 | In C it is UB, usually a segfault, and you cannot catch it |
| `undefined` ≈ garbage | 6.4 | No sentinel value; reading it is indeterminate |
| Chrome heap snapshot ≈ LSan/Valgrind | 6.5 | Similar purpose |

---

### Module 7: Memory II: Files, Binary Formats and Memory Bugs [L]
**Why it matters to this audience.** They have parsed ArrayBuffers and drawn on canvas ImageData. Real binary formats bring padding, endianness, row padding and clamping into play, along with disciplined memory-bug hunting.

**Time:** 15 h = 3 weeks (lessons 6 h, problem set 3.5 h, project 4.5 h, checkpoint 1 h).

**Lessons**
- **7.1 Streams and `FILE *`.** `fopen` modes, `fclose`, `fprintf`/`fgets`, `errno`/`perror`, stderr, exit codes.
  - Interactions: CODE `cp`.
  - Video: CS50x W4 lecture 02:02:35–02:19:00 (file I/O through JPEG signatures).
- **7.2 Binary I/O.** `fread`/`fwrite` size/count semantics, return values, short reads, `feof` vs `ferror`; `uint8_t`, `int16_t`.
  - Interactions: PRED what `fread` returns on a short file; FIX the `while(!feof)` bug (the last record is processed twice).
- **7.3 Parsing a header.** The WAV 44-byte header; reading into a byte array vs into a struct (padding! §0.8); scaling int16 samples with clamping.
  - Interactions: V4 on a real WAV; CODE Volume.
- **7.4 Images as pixel grids.** BMP file header (14 bytes) + info header (40); BGR order; bottom-up rows; rows padded to multiples of 4; heap-allocated 2D via `RGB (*img)[w] = calloc(h, sizeof *img)` (VLAs are optional in C17; gcc and clang support them).
  - Interactions: V4.
- **7.5 Filters.** grayscale; sepia (clamped to 255); reflect; box blur (needs a copy buffer); Sobel edges (Gx/Gy, `sqrt`, cap at 255, borders treated as black).
  - Interactions: PRED a 3×3 blur value; FIX "streaky" output from in-place blurring.
- **7.6 File carving.** Blocks, signatures, slack space.
  - Interactions: A9; CODE Recover.
- **7.7 Memory-bug clinic.** Valgrind invalid read/write, "Conditional jump or move depends on uninitialised value(s)", definitely vs indirectly lost; ASan; macOS `leaks`.
  - Interactions: ERR on 6 real reports generated natively by the pipeline.
  - Optional second video: CS50x W4 lecture 01:14:07–01:26:47 (Valgrind, garbage values).

**Problem set:**
- Volume.
- **Recover.** The runner synthesizes a card.raw with junk before the first JPEG, block-aligned signatures and zero-filled slack. It checks the file count and byte-exact contents, names `000.jpg` onward, usage and missing-file errors returning 1, and that all files are closed (Valgrind/`leaks`).
- Reverse (optional; reverses a WAV by block alignment).

**Project: Filter, all five filters including sepia (CS50 less + more combined).** Original `bmp.h`. The test runner checks:
- per-function tests on 1×1, 2×2, 3×3 and 4×4 images with expected values from a native reference;
- edge and corner handling for blur and edges;
- rounding and capping;
- reflect with odd and even widths;
- whole-image comparison against reference BMPs;
- ASan clean;
- a 4000×3000 image runs without stack overflow (it must be heap-allocated).

**Checkpoint:** CODE (new problem: crop or vertical flip); PRED (`fread` return); V4 task (read width, height and bit depth from header bytes); ERR (Valgrind report); FIX (struct-padding misread).

**Retrieval sources:** M3 (endianness and sizes), M6 (pointers, `malloc`), M5 (2D loops).

**Outside resources:**
1. Beej Ch. 9 "File Input/Output".
2. K&R 2e §7.5 "File Access" and §7.6 "Error Handling—Stderr and Exit".

**Success criteria covered:** SC4 (primary), SC3, SC7 (binary formats), CS50 W4.

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| `fs.readFileSync` / streams ≈ `FILE *` | 7.1–7.2 | You own the buffers; reads can be short; every return value must be checked; you must `fclose` |
| DataView parsing ≈ struct over bytes | 7.3 | Padding and layout differ by platform; read field by field with fixed-width types |
| canvas `Uint8ClampedArray` ≈ BMP pixels | 7.4–7.5 | **C `uint8_t` wraps instead of clamping**; BMP is BGR, bottom-up and row-padded |
| Web Audio Float32 ≈ WAV int16 | 7.3 | Integer samples overflow when scaled |

---

### Module 8: Data Structures I: Lists, Stacks, Queues, Trees [L]
**Why it matters to this audience.** They use `push`, `shift` and `Map` daily without knowing what they cost. Building these structures by hand is where pointer skills turn into fluency.

**Time:** 15 h = 3 weeks (lessons 6 h, problem set 3 h, project 5 h, checkpoint 1 h).

**Lessons**
- **8.1 ADTs and resizable arrays.** Doubling `realloc`, amortized O(1); the `p = realloc(p, n)` leak.
  - Interactions: PRED the capacity sequence; FIX the realloc leak.
- **8.2 Singly linked lists.** Insert at head, tail and in sorted order; search; delete; free with a temporary pointer.
  - Interactions: A10; V2 TRACE; FIX use-after-free on `->next`.
- **8.3 Doubly linked lists and sentinels.** The `node **pp` insertion trick.
  - Interactions: MEM.
- **8.4 Stacks and queues.** Array stack; circular-buffer queue (modulo indices); linked versions; complexity table.
  - Interactions: CODE.
- **8.5 Binary search trees.** Recursive insert and search; in-, pre- and post-order traversal; height; degenerate trees; post-order free.
  - Interactions: V2 tree mode.
  - Video: CS50x W5 lecture 02:22:20–02:38:27 (trees, BSTs).
- **8.6 Recursive ownership.** Allocating and freeing a family tree.
  - Interactions: CODE Inheritance.
  - Also: the CS50 short "Singly-Linked Lists" (Week 5 shorts).

**Problem set:**
- **Inheritance**: recursive `create_family`, random inheritance of alleles, post-order `free_family`. The runner checks the generation count, that parent pointers are set and NULL only at the top, that each allele comes from a parent, and zero leaks.
- A linked-list library with tests.
- A BST library with tests.

**Project: `eventloop`, a simulated JS event loop.**
- Script input such as `setTimeout A 10`, `then B`, `log C`.
- Macrotask queue = growable circular buffer; microtask queue = linked list; timers = BST keyed by `(time, seq)`. Output is the execution order.
- The test runner checks:
  - microtasks drain before the next macrotask;
  - nested `then`;
  - equal-delay timers keep insertion order;
  - 10⁵ events within the time limit;
  - zero leaks and ASan clean.

**Checkpoint:** MEM (pointer diagram after 4 list operations); CODE (new problem: reverse a list in place and dedupe); PRED (traversal orders); FIX (realloc leak); complexity table.

**Retrieval sources:** M6 (pointers, `malloc`), M5 (recursion), M7 (file I/O).

**Outside resources:**
1. K&R 2e §6.5 "Self-referential Structures".
2. Beej Ch. 12 "Manual Memory Allocation".

**Success criteria covered:** SC5 (lists, stacks, queues, BSTs), SC3, SC6, CS50 W5.

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| `push`/`pop`/`shift` | 8.4 | A naive `shift` is O(n); in C you manage capacity yourself |
| Graphs of JS objects ≈ structs with pointers | 8.2 | You free manually, in the right order |
| Event loop | project | Same semantics, built from your own queues |
| `Map` ≈ BST | 8.5 | `Map` keeps insertion order; a BST keeps sorted order |

---

### Module 9: Data Structures II: Hash Tables, Tries and Speller [L]
**Why it matters to this audience.** `Map`, `Set` and object keys are hash tables they have never seen inside. Speller is CS50's showcase pset. We make it harder by requiring two backends plus measurement.

**Time:** 15 h = 3 weeks (lessons 5.5 h, problem set 2 h, project 6.5 h, checkpoint 1 h).

**Lessons**
- **9.1 Hashing.** djb2 and FNV-1a; uniformity; power-of-two masks vs modulo; case-insensitive hashing.
  - Interactions: V5; PRED bucket indices.
- **9.2 Separate chaining.** Load factor; resize and rehash.
  - Interactions: A11; V5 collision mode; CODE.
- **9.3 Open addressing.** Linear probing, tombstones, clustering; a preview of cache behaviour (M11).
  - Interactions: V5 probing mode.
- **9.4 Tries.** 27-way nodes (a–z plus apostrophe); memory cost.
  - Interactions: V5 trie mode; MEM.
- **9.5 Measuring.** `clock_gettime(CLOCK_MONOTONIC)` (POSIX), `getrusage`, `-O2`, warm-up, median of N, counting bytes allocated through a wrapper.
  - Interactions: BENCH.
- **9.6 Speller design studio.** The `dictionary.h` contract; reading words; `strcasecmp` is POSIX (`<strings.h>`), not C17, so learners write their own case-folding compare as well.
  - Video: CS50x W5 lecture 02:38:27–03:01:55 (hashing, hash tables, tries).

**Problem set:** word-frequency counter (hash map from string to count, top-k via `qsort`).

**Project: Speller++ (at least as hard as CS50 Speller).**
- One `dictionary.h` interface (`load`, `check`, `size`, `unload`) with **both a chained hash table and a trie backend**, chosen with `make BACKEND=hash|trie`.
- A benchmark report: TIME IN load/check/size/unload plus peak bytes allocated.
- The test runner checks:
  - output identical to the reference across 6 texts × 2 dictionaries;
  - case-insensitivity and apostrophes;
  - `size` is correct;
  - `unload` frees everything (ASan/LSan, Valgrind or `leaks`);
  - **performance**: `check` total must be at least k× faster than a provided sorted-array plus `bsearch` baseline on the same machine; we use a baseline instead of a staff solution to avoid spoilers;
  - the report file exists and its numbers parse.

**Checkpoint:** V5 (predict collisions, probes and resizes); CODE (new problem: open-addressing int set with delete); FIX (**`hash += c` with signed `char` gives a negative index; it fails on x86-64/macOS but not on aarch64-Linux, see §0.7**); ERR (ASan heap overflow at a bucket index); PRED complexity.

**Retrieval sources:** M8 (lists), M3 (masks, char signedness), M7 (files), M5 (Big-O).

**Outside resources:**
1. K&R 2e §6.6 "Table Lookup".
2. The CS50x W5 segment above.

**Success criteria covered:** SC5 (hash tables, tries), SC6, SC4, CS50 W5. **This completes CS50 parity.**

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| `Map`/`Set` ≈ hash table | 9.1–9.3 | You choose the hash function, the collision strategy and when to resize |
| `performance.now()` ≈ `clock_gettime` | 9.5 | Similar purpose |
| String keys | 9.6 | JS interns and compares by value; C compares bytes, with case folding done by hand |

---

### Module 10: Inside the CPU: Instructions, Registers and Assembly [L+B]
**Why it matters to this audience.** It explains why C is "close to the metal", makes the stack and pointers concrete, and covers the brief's "read simple assembly from their own C". Mac learners see arm64 and WSL learners see x86-64, so we teach both side by side (verified possible from one CI machine, §0.14).

**Time:** 10 h = 2 weeks (lessons 5 h, project 4 h, checkpoint 1 h).

**Lessons**
- **10.1 How a CPU runs code.** Program counter, registers, ALU, flags, fetch-decode-execute; machine code vs assembly vs wasm bytecode.
  - Interactions: A12; MCQ.
- **10.2 First assembly.** `add` on both ISAs (`leal (%rdi,%rsi),%eax` / `add w0,w1,w0`); register widths (`eax`/`rax`, `w0`/`x0`).
  - Interactions: X1; PRED "which register holds the return value?"; PAR.
- **10.3 Control flow.** `cmp` plus conditional jumps; loops (the verified sum loop); switch jump tables.
  - Interactions: match C snippets to asm listings.
- **10.4 Memory operands.** `(%rdi,%rcx,4)` vs `ldrsw x9,[x0],#4`; struct field offsets (tied to M3 padding).
  - Interactions: MEM.
- **10.5 Procedures and the stack.** call/ret and bl/ret; frames; SysV argument registers (rdi, rsi, rdx, rcx, r8, r9 → rax) vs AAPCS64 (x0–x7 → x0); caller- vs callee-saved; how a stack smash overwrites the return address.
  - Interactions: V1 registers mode (TRACE).
- **10.6 Optimization levels.** `-O0` vs `-O2`; why `volatile` exists; how the optimizer exploits UB.
  - Interactions: PRED with real outputs.

**Project: "Defuse", reverse engineering.**
- Per-platform `phases.o` built in CI (x86-64 ELF, arm64 Mach-O, aarch64 ELF). There are 5 phases; inputs are found with `objdump -d`, `otool -tvV` or lldb's `disassemble`.
- Plus 2 "write C that compiles to this" items.
- The test runner links the learner's answers against a harness and requires every phase to return success. Match-the-asm items are checked by randomized behavioural tests plus an instruction count at or below target at `-O1`.

**Checkpoint:** choose the C source for 3 asm listings; TRACE register values over 5 instructions; CODE (write C from asm).

**Retrieval sources:** M3 (two's complement, bitwise), M5 (recursion, stack), M6 (pointers).

**Outside resources:**
1. CS:APP 3e Ch. 3 "Machine-Level Representation of Programs", §3.1–3.7.
2. Nand2Tetris Project 4 "Machine Language" (optional: Project 5 "Computer Architecture").

**YouTube:** none; animations carry this module.

**Success criteria covered:** SC8 (CPU and registers), SC9 (primary).

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| V8 Ignition bytecode → TurboFan machine code | 10.1, 10.6 | C is compiled ahead of time once: no guards, no deoptimization |
| WebAssembly text ≈ assembly | 10.2 | wasm is a stack machine (`local.get`, `i32.add`, verified); CPUs are register machines |
| DevTools call stack ≈ real frames | 10.5 | Real frames hold return addresses and saved registers, which can be overwritten |

---

### Module 11: Memory Hierarchy and Performance [L+B]
**Why it matters to this audience.** It covers the brief's "why access patterns affect performance". This audience already thinks about render performance and is ready to think about cache misses.

**Time:** 10 h = 2 weeks (lessons 5 h, project 4 h, checkpoint 1 h).

**Lessons**
- **11.1 The hierarchy.** Approximate latencies; temporal and spatial locality.
  - Interactions: A13; MCQ.
- **11.2 Caches.** Lines, sets, ways, tags; direct-mapped vs set-associative; LRU.
  - Interactions: V6 (predict hit or miss for each access); compute the address → tag/set/offset split.
- **11.3 Access patterns.** Row- vs column-major; stride; AoS vs SoA; array vs linked-list traversal.
  - Interactions: BENCH on the learner's own machine; PRED a bucketed speedup (reference numbers from CI).
- **11.4 Honest benchmarking.** Warm-up, repetitions, median; defeating dead-code elimination; variance; `perf` (Linux; may not work in WSL2, unverified) or Instruments (macOS).
- **11.5 Cache-aware code.** Blocking and tiling for transpose and multiply; probing vs chaining revisited.

**Project: `cachesim` + transpose.**
- Part A: a set-associative LRU simulator over memory traces (L/S/M records, shipped with the starter and generated in CI).
- Part B: a blocked matrix transpose, with misses counted by the learner's own simulator.
- The test runner checks:
  - hits, misses and evictions equal the reference for 8 (s, E, b, trace) combinations;
  - the transpose is correct;
  - transpose misses stay under thresholds for 32×32 and 64×64 at s=5, E=1, b=5 (CS:APP cachelab parameters, from memory).

**Checkpoint:** V6 sequence prediction; tag/set/offset computation; CODE (loop interchange, measured); PRED benchmark ranking.

**Retrieval sources:** M10 (memory operands), M3 (address bits), M9 (probing), M8 (lists).

**Outside resources:**
1. CS:APP 3e Ch. 6 "The Memory Hierarchy", §6.1–6.7.
2. CMU 15-213 lecture slides "Cache Memories" (schedule page; reading 6.4–6.7).

**YouTube:** none.

**Success criteria covered:** SC8 (caches, access patterns: primary).

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| TypedArray vs array of objects | 11.3 | Same lesson: contiguous data is fast and pointer-chasing is slow |
| Memoization cache ≈ hardware cache | 11.2 | Hardware caches are fixed sets indexed by address bits, automatic and invisible |
| Layout thrashing ≈ cache misses | 11.1 | Loose analogy only |

---

### Module 12: The Operating System: Processes, System Calls, Files and Virtual Memory [L, POSIX]
**Why it matters to this audience.** Node's `fs` and `child_process` are thin wrappers over these system calls, and every terminal pipe they type is `fork`, `exec` and `dup2`. This module covers the brief's "system calls for files and processes and what the OS does".

**Time:** 15 h = 3 weeks (lessons 6.5 h, problem set 2.5 h, project 5 h, checkpoint 1 h).

**Lessons**
- **12.1 What the OS does.** User vs kernel mode; traps; limited direct execution; `strace` on WSL (`dtruss` needs SIP changes, so Mac learners use the browser's replay of `strace` output from CI).
  - Interactions: A14; PRED a bucketed syscall count for hello world.
- **12.2 File descriptors.** `open`/`read`/`write`/`close`/`lseek`; the fd table; stdio buffering layered on top.
  - Interactions: BENCH copying with 1-byte vs 4 KiB buffers (time and syscall counts).
- **12.3 Processes.** `fork`, the `exec` family, `waitpid`, `WIFEXITED`/`WEXITSTATUS`, zombies and orphans.
  - Interactions: PRED the verified printf+fork duplication; PRED fork trees.
- **12.4 Pipes and redirection.** `pipe`, `dup2`, how shells implement `|`, `<` and `>`.
  - Interactions: V2 fd-table mode (MEM).
- **12.5 Signals (basics).** SIGINT, SIGSEGV, SIGPIPE; default actions; async-signal-safety caveats.
- **12.6 Virtual memory.** Pages, page tables, TLB, page faults; a segfault is an invalid access; copy-on-write `fork`; `mmap`; ASLR (verified: ordering stable, values change); `/proc/self/maps` on WSL.
  - Interactions: A15; MEM.

**Problem set:** `mycat`; `mycp` plus the buffer-size benchmark; `ls`-lite (`opendir`, `readdir`, `stat`).

**Project: `minishell`.**
- A REPL; builtins `cd`, `exit` and `pwd`; `fork`+`execvp`+`waitpid`; `<`, `>`, `>>`; a single `|` (stretch: N stages); `$?`; Ctrl-C kills the child, not the shell.
- The test runner (script mode on stdin) checks:
  - stdout, stderr and exit codes;
  - a missing command prints an error and gives status 127;
  - no fd leaks (children see only 0, 1 and 2: `/proc/self/fd` on Linux, `lsof` on macOS);
  - no zombies;
  - ASan clean.

**Checkpoint:** PRED (fork-tree line counts); MEM (fd table after `pipe`/`dup2`); CODE (new problem: `run_pipeline(a, b)` or `timeout cmd`); ERR (find the failing syscall and errno in an `strace` excerpt).

**Retrieval sources:** M7 (stdio), M6 (memory layout), M10 (stack, registers), M4 (what linking produces).

**Outside resources:**
1. OSTEP Ch. 5 "Process API" and Ch. 39 "Files and Directories" (optional: Ch. 4 "Processes", 13 "Address Spaces", 18 "Introduction to Paging").
2. CS:APP 3e Ch. 8 §8.1–8.4 and Ch. 10 "System-Level I/O".

**YouTube:** none.

**Success criteria covered:** SC10 (primary), SC1 (the load step), SC2 (virtual address space).

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| `child_process.spawn` ≈ `fork`+`exec` | 12.3 | `fork` clones the entire process (copy-on-write); JS has no equivalent |
| Node `fs.openSync`/`readSync` with fds ≈ syscalls | 12.2 | Close: libuv wraps the same calls |
| Browser site isolation ≈ process address spaces | 12.6 | Similar purpose |
| `console.log` buffering ≈ `printf` buffering | 12.3 | Buffers are duplicated by `fork` |

---

### Module 13: Linking, Loading, Libraries and the C ABI [L]
**Why it matters to this audience.** It explains why C is the lingua franca: N-API, Python's C API, Rust FFI and WebAssembly all speak the C ABI. It closes the loop back to the browser.

**Time:** 10 h = 2 weeks (lessons 5 h, project 4 h, checkpoint 1 h).

**Lessons**
- **13.1 Objects and symbols.** `nm`, `objdump`/`otool`; external vs internal linkage; strong vs weak symbols; relocation; ELF vs Mach-O.
  - Interactions: X1; PRED symbol visibility.
- **13.2 Static libraries.** `ar`; link order (GNU ld is order-sensitive and ld64 is not; unverified); only the needed objects are pulled in.
  - Interactions: ERR on a link-order failure.
- **13.3 Shared libraries and the loader.** `-fPIC`; `.so`/`.dylib`; rpath; `ldd`/`otool -L`; ld.so/dyld; PLT/GOT concept; `dlopen`/`dlsym`.
  - Interactions: A16; ERR "cannot open shared object file" / dyld "Library not loaded".
- **13.4 The C ABI.** Calling convention (M10); layout and alignment (M3); ABI stability through opaque pointers; `extern "C"`; varargs.
  - Interactions: MEM.
- **13.5 C ↔ JS through WebAssembly.** Exports; linear memory is an ArrayBuffer; strings cross as UTF-8 pointer+length; who frees what; the wasm32 sizes again.
  - Interactions: CODE in the browser runner.
- **13.6 UB and portability review.** Signed overflow, out-of-bounds, strict aliasing, unsequenced side effects, shifts, `char` signedness, `long` size; `static_assert`; `<stdint.h>`.
  - Interactions: MCQ "spot the UB".

**Project: `libdict`.**
- Package the M9 hash table as `libdict.a` + `libdict.so`/`.dylib` with an opaque `dict_t *` API, `-fvisibility=hidden` plus explicit exports, and a versioned header.
- Stretch: a `dlopen`-loaded hash-function plugin; a wasm build called from JS.
- The test runner checks:
  - the exported dynamic symbol set equals the public API exactly (`nm -D` or `nm -gU`);
  - the client passes its tests when linked statically and when linked dynamically;
  - **changing the internal struct and relinking only the shared library still works with the unchanged client binary** (proves the opaque ABI).

**Checkpoint:** ERR ×2 (link-time and load-time); PRED (visible symbols); MEM (address space with mapped libraries); CODE (opaque header plus export fixes).

**Retrieval sources:** M4 (stages), M10 (calling convention), M12 (exec), M3 (layout).

**Outside resources:**
1. CS:APP 3e Ch. 7 "Linking".
2. K&R 2e §4.3 "External Variables" through §4.6 "Static Variables".

**YouTube:** none.

**Success criteria covered:** SC11 (C ABI: primary), SC1 (link and load: complete).

**JS analogies**

| Analogy | Used in | Where it breaks down |
|---|---|---|
| npm package ≈ library | 13.2–13.3 | No package manager and no semver at the ABI level; one global symbol namespace |
| `import()` ≈ `dlopen` | 13.3 | Similar purpose |
| `.d.ts` ≈ header | 13.4 | A header is pasted into your code and can contain definitions by accident |
| wasm exports | 13.5 | JS strings must be copied into linear memory; there is no GC across the boundary |

---

## 4. Capstone: `mm`, a memory allocator (25 h = 5 weeks) [L]

**Task.** Implement `mm_init`, `mm_malloc`, `mm_free`, `mm_realloc` and `mm_calloc` with 16-byte alignment. The heap comes from a provided `memlib` (`mem_sbrk` over one large `mmap`/`malloc` region, so it behaves the same on macOS and Linux and avoids relying on `sbrk`).

**Milestones**
1. Implicit free list with boundary tags and first fit.
2. Coalescing (all four cases).
3. Explicit free list (LIFO, then address-ordered).
4. Segregated free lists plus a realloc fast path.
5. `mm_checkheap` invariant checker.
6. **Integration:** rebuild your Speller (M9) and eventloop (M8) with `-include mm_shim.h` (maps `malloc` to `mm_malloc`) and pass their test suites.
7. Report: the utilization vs throughput trade-off, with benchmark tables.

**Test runner (trace-driven driver).**
- Traces: random; binary-tree; realloc-heavy; one recorded from Speller.
- Correctness checks: payload alignment; no overlapping blocks; payload integrity (the driver writes random bytes and verifies them); realloc preserves contents; calloc zeroes; `mm_checkheap` passes after every operation in debug mode.
- Scores, with thresholds calibrated against the staff solution:
  - utilization (peak payload / heap size): e.g. 70% or more;
  - throughput relative to libc malloc on the same machine: e.g. 0.25× or better.
- Speller and eventloop stay correct under `mm`.
- ASan cannot see inside a custom heap, so the driver uses canaries plus `mm_checkheap`; Valgrind client requests are an optional extra.

**Why it is harder than CS50 Speller.** It needs:
- raw byte pointer arithmetic and bit-packed headers (M3, M6);
- alignment (M3, M13);
- linked structures living inside untyped memory (M8);
- OS memory (M12) and performance work (M11);
- debugging without sanitizer coverage.

**Outside resources:**
1. CS:APP 3e §9.9 "Dynamic Memory Allocation".
2. K&R 2e §8.7 "Example—A Storage Allocator" (optionally OSTEP Ch. 17 "Free Space Management").

---

## 5. Success criteria → module coverage
● = primary, ○ = reinforced

| Success criterion | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | Cap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SC1 Source → process (preprocess, compile, link, load) | ○ | ○ | | ● | | | | | | ○ | | ● (load) | ● | |
| SC2 Memory layout and where variables live | | | ○ | | ○ | ● | ○ | ○ | | ○ | | ● (VM) | ○ | ○ |
| SC3 Pointers, arrays, strings, structs, dynamic memory | | ○ | | | ○ (structs) | ● | ● | ● | ○ | | | | | ● |
| SC4 Memory bugs with lldb/gdb and ASan/Valgrind | | | | ● | | ● | ● | ○ | ○ | | | ○ | | ○ |
| SC5 Lists, stacks, queues, hash tables, BSTs, tries | | | | | | | | ● | ● | | | | ○ | ○ |
| SC6 Big-O, standard sorting and searching | | | | | ● | | | ○ | ○ | | ○ | | | |
| SC7 Binary, hex, two's complement, floats, endianness, bitwise | ○ | ○ | ● | | | ○ | ● | | ○ | ○ | ○ | | | ○ |
| SC8 CPU execution, registers, caches, access patterns | | | | | | | | | | ● | ● | | | ○ |
| SC9 Read simple assembly from own C | | | | ○ (`-S`) | | | | | | ● | ○ | | ○ | |
| SC10 Syscalls for files and processes; what the OS does | | | | | | | ○ | | | | | ● | ○ | ○ |
| SC11 Multi-file projects, Make, headers, C ABI | | | | ● | ○ | ○ | ○ | ○ | ○ | | | ○ | ● | ○ |
| CS50x W1–W5 parity | ● W1 | ● W2 | ○ | ● W2 | ● W3 | ● W4 | ● W4 | ● W5 | ● W5 | | | | | |

---

## 6. CS50x 2026 problem-set parity

| CS50 pset (2026) | CS50 requirement | Our equivalent | Module | Harder because… |
|---|---|---|---|---|
| Hello, World | practice | 1.1 CODE | M1 | equal |
| Hello, It's Me | submit | 1.3 CODE (empty name re-prompts) | M1 | adds validation |
| Mario (less / more) | one of | **Mario-more required**; less as warm-up (1.4) | M1 | harder version required |
| Cash / Credit | one of | Cash (problem set) **and** Credit (project) | M1 | both required; Credit must match under wasm32 (no `long`) |
| Scrabble | submit | Problem set | M2 | equal |
| Readability | submit | Problem set + rounding lesson | M2 | equal, plus C vs JS rounding |
| Caesar / Substitution | one of | **`cipher`: both plus decrypt, property-tested** | M2 | both, plus round-trip |
| Wordle (CS50x 2022 era) | not in 2026 | optional M2 CODE | M2 | — |
| Sort | submit | Identify black-box binaries **plus implement all three plus doubling table** | M5 | adds implementation and empirical Big-O |
| Plurality | submit | Problem set | M5 | equal |
| Runoff / Tideman | one of | **Tideman required** (project); Runoff optional | M5 | harder version required |
| Volume | submit | Problem set (with clamping) | M7 | adds overflow handling |
| Filter (less / more) | one of | **All five filters** (grayscale, sepia, reflect, blur, edges) + a large-image heap test | M7 | union of both versions |
| Recover | submit | Problem set, randomized synthetic card | M7 | randomized data |
| Inheritance | submit | Problem set | M8 | equal, plus leak checks |
| Speller | submit | **Speller++: hash table and trie, benchmark report, beats the baseline** | M9 | two backends plus measurement |
| (none) | — | `utf8`, `libstr`, `eventloop`, Defuse, `cachesim`, `minishell`, `libdict`, `mm` | M3, M6, M8, M10–13, Cap | beyond CS50 |

---

## 7. CS50 lecture concepts → lessons

**Week 1**
- Hello World, header files, man pages → 1.1
- Hello You → 1.3
- Linux commands → 4.1 quick reference
- Conditionals, compare.c, agree.c → 1.3
- Types, format codes, variables → 1.2
- Loops and meow → 1.4
- Functions → 1.5
- Correctness, design, style → 1.5 plus the style check
- Mario → problem set
- Operators, overflow, truncation, floating-point imprecision → 1.2 and 1.6 (deepened in 3.2 and 3.4)
- Magic numbers short → 1.5

**Week 2**
- Reading levels → 2.4
- Debugging (printf, debugger, rubber duck) → 4.5
- Compiling → 4.2
- Arrays → 2.1
- Strings and string length → 2.2
- Command-line arguments and exit status → 2.5
- Variables and scope short → 1.5

**Week 3**
- Linear and binary search → 5.2
- Running time (O, Ω, Θ) → 5.1
- phonebook and structs → 5.3
- Selection and bubble sort → 5.4
- Recursion and call stacks → 5.5
- Merge sort → 5.6

**Week 4**
- Pixel art and hexadecimal → 3.1 and 7.4
- Memory and pointers → 6.1
- Strings as `char *` → 6.3
- Pointer arithmetic → 6.3
- String comparison → 2.3 and 6.3
- Copying and malloc → 6.5
- Valgrind → 6.5 and 7.7
- Garbage values → 1.5 and 6.4
- Binky → 6.1
- Swapping → 6.2
- Overflow → 6.4 and 6.7
- scanf → 6.2 and 6.7
- File I/O → 7.1–7.2
- Custom types short → 5.3

**Week 5**
- ADTs → 8.1
- Queues and stacks → 8.4
- Resizing arrays → 8.1
- Singly and doubly linked lists → 8.2–8.3
- Trees and BSTs → 8.5
- Dictionaries, hashing and hash tables → 9.1–9.3
- Tries → 9.4

---

## 8. Further study (not covered properly in the course)
- **Threads and concurrency:** pthreads, data races, atomics. OSTEP Ch. 26 "Concurrency and Threads" through Ch. 33 "Event-based Concurrency"; Beej Ch. 39 "Multithreading" and Ch. 40 "Atomics".
- **Networking and sockets:** CS:APP Ch. 11 "Network Programming".
- **Full job-control shell** (the CMU tshlab level of `minishell`): CS:APP §8.5–8.8.
- **Virtual memory internals:** OSTEP Ch. 19–23. **File-system implementation:** OSTEP Ch. 40–42.
- **Balanced trees** (AVL, red-black), graph algorithms (BFS, Dijkstra), dynamic programming.
- **C23:** Modern C (free HAL edition / Manning 3rd ed.); Effective C 2nd ed. Both target C23.
- **Compilers and hardware from first principles:** Nand2Tetris Projects 1–12.
- **Fuzzing and static analysis:** libFuzzer/AFL; `clang --analyze`; `gcc -fanalyzer`.
- **SIMD, profiling in depth** (perf, Instruments), exploit techniques (ROP), Unicode normalization, embedded/bare-metal C.
- **CS50 Weeks 6–10** (Python, SQL, web) are out of scope by design.

---

## 9. Total course length
- **185 hours ≈ 37 weeks at 5 h/week (about 8.5 months).** That is 13 modules at 160 h plus a 25 h capstone.
- The CS50 C-parity core (M1, M2, M4–M9) is 105 h and ends at week 23.
- The low-level layer (M3, M10–M13) is 55 h.
- Per-module estimates include lessons, problem set, project, retrieval quiz and checkpoint.

---

## 10. Pipeline and authoring implications from what I verified
1. **Compare native and wasm32 output per sample.** Expected differences to whitelist with a lesson annotation, not flag as bugs:
   - `sizeof(long)`, `sizeof(void *)`, `sizeof(size_t)`;
   - padded struct sizes (§0.8);
   - `long double` precision;
   - **`char` signedness on aarch64-Linux** (WSL on ARM laptops; wasm32, x86-64 and arm64-macOS are signed).
2. **Address normalization is not enough.** Address *values* change between runs; their *ordering* is stable. PRED items should ask about order or relationships.
3. **Sanitizers in CI:** use gcc. The clang 18 in this image lacks the compiler-rt ASan archives. LSan works under gcc here, and Valgrind 3.22 works.
4. **Diagnostics differ between compilers** (implicit declaration is a gcc warning but a clang error). ERR exercises should show the learner's compiler: clang for the browser/Mac track, gcc for WSL, both stored by the pipeline.
5. **The X1 Build Explorer can be generated on one Linux CI box:** `clang --target={x86_64-pc-linux-gnu,arm64-apple-macosx,wasm32-unknown-unknown} -O1 -S`, for header-free snippets only. There is no macOS SDK, so `<stdio.h>` cannot be compiled for the Mac target.
6. **PRED answers must never depend on UB.** For UB demonstrations, store the native UBSan/ASan report as the answer.
7. **Linking:** WSL builds need `-lm` (verified failure without it); starter Makefiles should always pass `-lm`.

---

## Appendix A: Verified snippets and commands

```sh
# type sizes per target (no sysroot needed)
clang --target=wasm32-unknown-wasi -std=c17 -dM -E -x c /dev/null | grep -E '__SIZEOF_(LONG|POINTER|SIZE_T|LONG_DOUBLE)__|__CHAR_UNSIGNED__'
# struct layout per target without running: arrays sized by sizeof/offsetof, read with nm
clang --target=wasm32-unknown-wasi -std=c17 -c layout.c -o l.o && llvm-nm --print-size l.o
# sanitizers (gcc in this image)
gcc -std=c17 -Wall -Wextra -pedantic -g -fsanitize=address,undefined -fno-omit-frame-pointer bugs.c -o bugs_asan
valgrind --leak-check=full --error-exitcode=1 ./bugs_plain 3
# cross-ISA asm for the Build Explorer
clang --target=arm64-apple-macosx -O1 -S -o - asm.c
```

Course helper (MIT; replaces GPL libcs50). Verified with gcc 13.3 under `-std=c17 -Wall -Wextra -pedantic`, and in the Mario-more re-prompt test:

```c
// learnc.h - #define LEARNC_IMPL in exactly one .c file
#ifndef LEARNC_H
#define LEARNC_H
#include <stdbool.h>
bool get_int(const char *prompt, int *out);   // re-prompts until a valid int; false on EOF
#ifdef LEARNC_IMPL
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
bool get_int(const char *prompt, int *out) {
    char buf[256];
    for (;;) {
        fputs(prompt, stdout); fflush(stdout);
        if (!fgets(buf, sizeof buf, stdin)) return false;
        char *end; errno = 0;
        long v = strtol(buf, &end, 10);
        while (isspace((unsigned char)*end)) end++;
        if (end != buf && *end == '\0' && errno == 0 && v >= INT_MIN && v <= INT_MAX) { *out = (int)v; return true; }
    }
}
#endif
#endif
```

Note for test runners: when stdin is piped, prompts are not followed by newlines, so the output reads `Height: Height: …`. The comparison logic has to tolerate this, as check50 does.

**Files** (all under `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/course-outline-cs50-parity/`):
- `cs50/` holds the specs, notes and lecture SRTs.
- `books/` holds the OSTEP, Beej, CMU 15-213, Pearson CS:APP, No Starch Effective C, Modern C (HAL PDF) and K&R sample TOC pages.
- `verify/` holds `layout.c`, `bugs.c`, `predict.c`, `p2.c`, `errs.c`, `rd.c`, `asm.c`, `forkbuf.c`, `stackheap.c`, `learnc.h` and `mario.c`.

**Sources:**
- [CS50x 2026](https://cs50.harvard.edu/x/) and its [problem sets](https://cs50.harvard.edu/x/psets/1)
- [CS50 licence](https://cs50.harvard.edu/x/license/)
- [OSTEP](https://pages.cs.wisc.edu/~remzi/OSTEP/)
- [Beej's Guide to C](https://beej.us/guide/bgc/html/split/index.html)
- [CMU 15-213 schedule](https://www.cs.cmu.edu/~213/schedule.html)
- [Pearson CS:APP 3e](https://www.pearson.com/en-us/subject-catalog/p/computer-systems-a-programmers-perspective/P200000003479/9780134092669)
- [K&R 2e sample pages](https://www.ciscopress.com/content/images/9780131103627/samplepages/0131103628.pdf)
- [Modern C](https://gustedt.gitlabpages.inria.fr/modern-c/) / [HAL](https://inria.hal.science/hal-02383654v2)
- [Effective C 2e](https://nostarch.com/effective-c-2nd-edition)
- [Nand2Tetris](https://www.nand2tetris.org/course)
- [Wellesley CS240 floats slides (CSAPP 2.4)](https://cs.wellesley.edu/~cs240/f22/slides/floats.pdf)