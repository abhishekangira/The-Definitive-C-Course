# Bottom-up C course outline: bits → CPU → toolchain → memory → data structures → OS

This report has three parts. Part A lists what I verified by running it in this container. Part B lists what I read in primary documents. Part C onward is the full outline: 12 modules plus a capstone, about 177.5 h, which is about 36 weeks at 5 h/week.

---

## A. Verified by running it (container, 2026-10-15)

**Tooling.** I used `@yowasp/clang@22.0.0-git20542-10` (npm) as a stand-in for an in-browser C toolchain. It is Clang/LLD compiled to wasm and targets wasm32-wasi. I installed it in my scratch dir and ran it in Node v22.22.0 with `node:wasi`. Native comparisons used gcc 13.3.0 (x86-64) and system clang 18.1.3 for cross-target `-S` and `-dM`.
- Package sizes: unpacked 105,501,358 B. `gen/llvm.core.wasm` is 75,532,134 B raw and 22,769,223 B gzip-6. `gen/llvm-resources.tar` is 29,665,280 B raw and 4,307,195 B gzip-6. `bundle.js` is 253,926 B.
- A warm compile-and-run of a small file took about 1.1 s wall time in Node.

Minimal harness that worked (`/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/bottom-up-outline/scripts/wflags.mjs`):
```js
const { runClang } = await import(process.env.YOWASP_BUNDLE);
files = await runClang(['clang','-std=c17','-Wall','-Wextra','-pedantic',...extra, name,'-o','a.wasm'],
                       {[name]: src}, {stderr: b => { if (b) err += dec.decode(b); }});
const wasi = new WASI({version:'preview1', args:[name], returnOnExit:true});
const inst = await WebAssembly.instantiate(await WebAssembly.compile(files['a.wasm']), {wasi_snapshot_preview1: wasi.wasiImport});
wasi.start(inst);
```

### A1. Same source, different machine (`samples/repr.c`, `-std=c17 -Wall -Wextra -pedantic -O0`)

| | wasm32 (yowasp clang 22) | x86-64 Linux (gcc 13.3) | arm64 macOS* | aarch64 Linux* |
|---|---|---|---|---|
| sizeof long / void* / size_t | **4 / 4 / 4** | 8 / 8 / 8 | 8 / 8 / 8 | 8 / 8 / 8 |
| sizeof long double | 16 | 16 | **8** | 16 |
| char signedness | signed | signed | signed | **unsigned** |
| byte order | little | little | little | little |
| `struct{char c; void*p;}` size (offset of p) | **8 (4)** | 16 (8) | – | – |
| `struct{char;int;char;}` vs `{int;char;char;}` | 12 vs 8 | 12 vs 8 | – | – |
| `0.1+0.2` (`%.17g`), `16777217.0f` | 0.30000000000000004, 16777216.0 | same | – | – |
| `-7/2`, `-7%2`, `-7>>1` | -3, -1, -4 | same | – | – |
| `(unsigned char)250+10`, `(unsigned)-1` | 4, 4294967295 | same | – | – |

\*The arm64 macOS and aarch64 Linux columns come from `clang --target=<triple> -E -dM -x c /dev/null` predefined macros (`__CHAR_UNSIGNED__`, `__SIZEOF_LONG_DOUBLE__`, and so on), not from running code.

Also verified: `int i=-1; unsigned u=3; i<u` evaluates to false, and `sizeof(int)-5 > 0` is true (gcc warns via `-Wsign-compare`).

### A2. Diagnostics differ by compiler
- Calling undeclared `get_string`: clang 22 (browser) gives a hard **error** (`call to undeclared function … ISO C99 and later do not support implicit function declarations`). gcc 13.3 gives a **warning** and then the link fails (`collect2: error: ld returned 1 exit status`).
- gcc reported `'n' is used uninitialized [-Wuninitialized]`. clang printed no uninitialized warning in that run; it skips flow-analysis warnings once a file has errors. Compiler-error lessons therefore need stored messages per compiler.

### A3. Undefined behaviour in the browser does not crash
- `*NULL` printed `0`. A heap write one past the end (`a[4]` on `malloc(4*sizeof(int))`) ran silently, and `a[4]` printed `4`. Wasm linear memory has no unmapped page 0.
- Natively, ASan reports `heap-buffer-overflow … WRITE of size 4 … oob.c:5`.
- `-fsanitize=undefined -fsanitize-trap=undefined` **works in the browser toolchain**: signed overflow traps with `RuntimeError: unreachable`, with no message.
- `-fsanitize=address` and plain `-fsanitize=undefined` **fail to link** (undefined `__asan_*` and `__ubsan_handle_*` symbols).
- Default wasm shadow stack is **64 KiB** and sits below the globals: `&local≈0xfff8 < &global=0x10998 < heap=0x11150`. A 200 KiB recursion traps with `memory access out of bounds`. Adding `-Wl,-z,stack-size=8388608` fixes it, and the output then matches native (`result=1412`).

### A4. The browser toolchain can run the whole pipeline (`scripts/wpipe.mjs`)
- `-E -P` (macro expanded) works, as do `-S` and `-c` for two files.
- `runLLVM(['nm', …])` works. It shows `T add`, `D counter`, and `t helper` (lowercase t for a `static` function), plus `U add` and `U counter` in `main.o`.
- Linking `main.o` alone gives real errors: `wasm-ld: error: main.o: undefined symbol: add`.
- Calling C from JavaScript works (`scripts/wffi.mjs`): an exported C function received a pointer that JS saw as the number `65536`. JS filled `new Uint8Array(memory.buffer, p, 4)`, and `sum_u8(p,4)` returned 100. The `.wasm` was 497 B.

### A5. Assembly of one function on three targets (`long sum(const long*a,long n)`, `-O1`)
- x86-64 gcc: `leaq (%rdi,%rsi,8),%rcx` / `addq (%rax),%rdx` / `addq $8,%rax`
- arm64-apple clang: `ldr x9,[x0],#8` / `add x8,x9,x8` / `subs x1,x1,#1` / `b.ne`
- wasm32 clang: a stack machine. `i32.load`, then `i32.const 4`, `i32.add`, because `long` is 4 bytes there.

### A6. Cache effect (`samples/cache.c`, 2048×2048 int, 4 passes, `-O1`)
- Native: row-major 0.008–0.009 s vs column-major 0.151–0.155 s, a **17.6–19.9× difference**.
- wasm in Node: 0.030 s vs 0.137 s, **4.6×**.
- Timing is machine-dependent, so predictions should be about direction and order of magnitude, and the verification pipeline must normalize timings.

## B. Read in primary documents (verified by fetching them)

**CS50x 2026** (from `cs50.harvard.edu/x/psets/N/`, fetched with curl):

| Pset | Problems |
|---|---|
| PS1 | Hello, World (complete); Hello, It's Me; Mario less **or** more; Cash **or** Credit |
| PS2 | Scrabble; Readability; Caesar **or** Substitution. **Wordle is not in CS50x 2026**; I kept it because the client listed it. |
| PS3 | Sort; Plurality; Runoff **or** Tideman |
| PS4 | Volume; Filter less **or** more; Recover |
| PS5 | Inheritance; Speller (hash table, wall-clock benchmark, `check/hash/load/size/unload`, `LENGTH 45`) |

- Week titles: 1 C, 2 Arrays, 3 Algorithms, 4 Memory, 5 Data Structures. Week topic lines were captured verbatim and drive Table G2.
- Practice problems: Debug, Half, Prime, Hours, N0 V0w3ls, Password, Recursive atoi, Average Temperatures, Max, Snackbar, Bottom Up, License, Trie.
- License: CC BY-NC-SA 4.0. Our equivalents must use original specs and data.

**CS50 lecture video segments.** YouTube IDs come from the CS50x 2026 week pages (Fall 2025 lectures). Timestamps come from the official `.srt` captions at `cdn.cs50.net/2025/fall/lectures/N/lang/en/lectureN.srt`. YouTube itself is unreachable from here, so I could not confirm that the captions line up with YouTube's timing.

| Lecture | Video ID |
|---|---|
| L1 | SlqjA04_dpk |
| L2 | h5Gc1n8ZuU8 |
| L3 | 6Svu_ae5ebk |
| L4 | db0H0U13YsA |
| L5 | PmAI76OGE_E |

**CS:APP 3e** (table of contents from the publisher preface PDF, csapp.cs.cmu.edu):

| Ch. | Title | Start page |
|---|---|---|
| 1 | A Tour of Computer Systems | 1 |
| 2 | Representing and Manipulating Information | 31 |
| 3 | Machine-Level Representation of Programs | 163 |
| 4 | Processor Architecture | 351 |
| 5 | Optimizing Program Performance | 495 |
| 6 | The Memory Hierarchy | 579 |
| 7 | Linking | 669 |
| 8 | Exceptional Control Flow | 721 |
| 9 | Virtual Memory | 801 |
| 10 | System-Level I/O | 889 |
| 11 | Network Programming | – |
| 12 | Concurrent Programming | – |

Section start pages are used in the citations below. For example: §2.2 p.59, §2.4 p.108, §3.10.2 "Using the gdb Debugger" p.279, §6.4 p.614, §7.13 "Library Interpositioning" p.707, §9.9 p.839, §9.9.12 p.854, §9.11 p.870.

**OSTEP** (pages.cs.wisc.edu/~remzi/OSTEP/): 4 Processes; 5 Process API; 13 Address Spaces; 14 Memory API; 17 Free Space Management; 18 Introduction to Paging; 19 TLBs; 26–32 concurrency; 39 Files and Directories; 40 File System Implementation.

**Effective C 2e** (nostarch.com and the detailed TOC PDF):
- Chapters: 1 Getting Started; 2 Objects, Functions, and Types; 3 Arithmetic Types (p.47); 4 Expressions and Operators; 5 Control Flow; 6 Dynamically Allocated Memory (p.115); 7 Characters and Strings; 8 Input/Output (p.167, includes "Endian" p.191); 9 Preprocessor; 10 Program Structure (p.213, includes "Linkage"); 11 Debugging, Testing, and Analysis (p.229, includes AddressSanitizer p.253).
- Appendix on C23.

**Beej's Guide to C** v0.11.0: ch. 5 Pointers, 6 Arrays, 7 Strings, 17 Multifile Projects, 24 Bitwise Operations.

**Nand2Tetris** projects: 4 Machine Language, 5 Computer Architecture.

**Erickson, *Algorithms*:** ch. 1 "Recursion" (50 pp., includes mergesort and Tower of Hanoi); ch. 6 "Depth-First Search" (includes Topological Sort).

**CMU 15-213 Fall 2015 schedule:** lectures are videotaped on Panopto. Lecture 6 "Machine Prog: Control", Lecture 7 "Machine Prog: Procedures", Lecture 17 "Virtual Memory: Concepts".

**Secondary sources (search snippets only):**
- K&R 2e: ch. 4 Functions and Program Structure; ch. 5 Pointers and Arrays; §5.11 Pointers to Functions (p.118); §6.5 Self-referential Structures (p.139); §6.6 Table Lookup (p.143); ch. 8 UNIX System Interface.
- Modern C 3e (Manning, Oct 2025, C23): ch. 11 Pointers, ch. 15 Program failure, ch. 16 Performance. **I could not fetch its full TOC (bot wall), so it is not used as a primary resource.**

**From general knowledge, not verified here:** Valgrind has no Apple Silicon support; LeakSanitizer is unavailable with Apple clang (use `leaks --atExit`); gdb is unavailable on macOS arm64 (use lldb). Apple Silicon page size is 16 KiB.

---

## C. How the course is built

1. **Machine first, C as notation.** Every C construct arrives as the way to write a machine concept the learner has already met:
   - type = byte width plus interpretation (M1)
   - `if`/loops = compare and jump (M4)
   - function = call/ret plus a stack frame (M4/M6)
   - `a[i]` = base + i·size (M3/M6)
   - pointer = address (M7)
   - struct = offsets plus padding (M8)
   - `malloc` = an allocator carving up the heap (M7, then the capstone)
   
   Control-flow syntax is taught as differences from JS only (do-while, switch fallthrough, block scope, no truthy objects). General programming is not re-taught.
2. **Where code runs.**
   - M1–M4 run in the browser (wasm32).
   - M3 ends with a local-toolchain lab.
   - M5 starts in the browser (pipeline panel) and finishes natively.
   - M6 onward is native for debugger, sanitizer and project work. The browser keeps the visualizers, prediction drills and code-vs-tests items whose behaviour doesn't depend on the platform.
   - Every prediction item carries a **platform tag**: `wasm32`, `linux-x86_64` or `macos-arm64`. Answers are taken from pipeline runs on that target. UB samples are tagged *native+sanitizer only* because the browser hides UB (A3).
3. **Pacing pattern.** Each lesson is 3–6 "beats". Each beat is at most ~250 words, or one animation (30–90 s), or one video segment with a pause point, followed by an interaction. Hints come in tiers:
   - H1: restate the symptom
   - H2: point to the concept or visualizer
   - H3: a line-level hint
   
   The solution unlocks after 2 genuine attempts (changed code plus a test run) or after H3. A **variant exercise** then follows and is required.
4. **Interaction codes used in the tables:**
   - PR: predict before run
   - CT: code against automated tests
   - FB: fix the bug from a symptom
   - MD: memory-diagram fill-in
   - PA: Parsons problem
   - CE: interpret a real compiler, linker or sanitizer message
   - NP: number-playground drill
   - SS: stepper, predict the next state
   - AS: match or annotate assembly
   - DB: debugger task
   - VR: variant exercise
5. **Visualizers.** V1–V6 are the client's list; V7–V8 are added by this design.
   - V1 Number Playground (binary, hex, two's complement wheel, IEEE-754 bit editor)
   - V2 Byte Viewer (endianness, struct padding, hex dump)
   - V3 Stack/Heap Stepper with predict-next-state; it has frame, heap and array modes
   - V4 Pointer Diagram, editable for MD items
   - V5 Hash-Table Collision Visualizer
   - V6 Cache Simulator, whose address-split UI is reused for page tables in M12
   - **V7 TinyCPU Simulator**: 8 registers, PC/SP/flags, ~16 instructions, 64 KiB byte memory, shown side by side with C and x86-64/arm64 listings for course samples
   - **V8 Build Pipeline Panel**: in-browser `-E/-S/-c/nm`/link with real errors (feasibility shown in A4)
6. **HyperFrames animations (30–90 s):**

| ID | Animation | ID | Animation |
|---|---|---|---|
| A1 | Binary/hex odometer | A10 | malloc/free heap blocks |
| A2 | Integer wheel and overflow | A11 | Padding and byte order |
| A3 | Anatomy of a float | A12 | Merge sort |
| A4 | A string in memory | A13 | Pointer rewiring (list/BST) |
| A5 | Fetch–decode–execute | A14 | Cache line fill, row vs column |
| A6 | hello.c → process | A15 | Hash insert and chain |
| A7 | Symbol resolution and relocation | A16 | Syscall trap; fork/exec/wait |
| A8 | Call/return frames | A17 | Virtual address translation |
| A9 | Where variables live | A18 | Free-list split and coalesce |

7. **Gating with no backend.**
   - A checkpoint at ≥80% unlocks the next module. Retakes draw variants, and missed items return in later retrieval quizzes.
   - Native work is evidenced by a **runner completion token**: the first 8 hex digits of SHA-256(module ID + learner seed + pass bitmap). The learner pastes it into the app. This is honor-system and tamper-evident only.
   - Progress is stored in IndexedDB with JSON export/import.
8. **Retrieval quizzes.** Each module opens with 6–8 items, about 10 minutes. Roughly 50% come from the previous module and 50% from older modules, weighted by spaced repetition. M1 opens with a diagnostic instead.

---

## D. Modules

Success criteria (S-codes used below):
- **S1** source→process
- **S2** memory layout
- **S3** pointers, arrays, strings, structs, dynamic memory
- **S4** finding bugs with a debugger plus ASan/Valgrind
- **S5** data structures from scratch
- **S6** Big-O, sorting and searching
- **S7** number representation
- **S8** CPU, registers, caches, access patterns
- **S9** reading assembly
- **S10** system calls and the OS
- **S11** multi-file projects, Make, headers, ABI
- **S12** CS50 parity

### PART I — DATA (browser, wasm32)

#### M1. Bits, Bytes & Your First C Programs — 10 h (2 wk) · browser
**Why it matters for this audience:** In JS a value's representation is hidden; in C a type is a byte count plus an interpretation. Learners write C and read real compiler errors from day one.

**Time breakdown:** 5 lessons ×1 h, exercises 1.5 h, project 2.5 h, checkpoint 1 h.

| # | Lesson (1-line summary) | Interactions | Visual |
|---|---|---|---|
| 1.1 | Hello, machine: `main`, `#include`, `return 0` = exit status; errors are information | PR, CE (missing `;`, undeclared identifier: real clang text), CT hello and hello-me (fgets helper given) | – |
| 1.2 | Place value, binary/hex/octal, bytes and nibbles | NP, PR on `printf("%x")` | V1, A1, YT |
| 1.3 | Types = width + interpretation: `sizeof`, `<limits.h>`, unsigned; wasm32 values (long = 4) | PR (pinned to wasm32), multiple choice | V2 |
| 1.4 | Expressions and `printf` specifiers; mismatch is UB (-Wformat) | CE, PA | – |
| 1.5 | C control-flow differences from JS: do-while validation loops, `for`, prototypes before use | PA mario, CT mario-less, FB off-by-one pyramid | – |

- **Project:** Mario (less and more) plus `bits`, which prints an unsigned value in grouped binary and hex.
  - Runner checks exact stdout for heights 1–8.
  - Inputs 0, 9, -1 and `abc` must reprompt.
  - `bits 3735928559` must print `1101 1110 1010 1101 1011 1110 1110 1111` and `0xdeadbeef`.
  - Must compile with `-std=c17 -Wall -Wextra -pedantic -Werror`.
- **Checkpoint (10 items):** 3 NP conversions (generated), 2 PR, 1 CE, 1 PA, 1 CT (`count_ones`), 2 multiple choice on sizeof/wasm32.
- **Retrieval:** diagnostic on JS numbers (`toString(2)`, `typeof`, JS bitwise ops).
- **Resources:** CS:APP 3e §2.1 "Information Storage" (pp. 34–58); Beej's Guide to C ch. 2 "Hello, World!" and ch. 3 "Variables and Statements".
- **YouTube:** CS50 L4 `db0H0U13YsA` 00:07:30–00:13:30 (hexadecimal).
- **Criteria:** S7 (I), S1 (I), S12 (hello, me, mario).
- **JS analogies:**
  - 1.2: `n.toString(2)`, `parseInt(s,16)` and `0xff` literals are identical in C.
  - 1.3: `Uint8Array` and the DevTools memory inspector show "bytes". *Breaks:* TS types are erased at runtime; C types pick instruction widths, and there is no runtime `typeof`.
  - 1.4: `console.log` vs `printf`. *Breaks:* printf trusts the format string.
  - 1.5: `let` block scope. *Breaks:* an uninitialized C local holds garbage, not `undefined`.

#### M2. Integers: Two's Complement, Overflow & Bitwise Logic — 10 h (2 wk) · browser
**Why it matters:** JS hides integer widths outside its bitwise operators. Overflow and signed/unsigned conversions are classic C bugs and the source of real incidents (Boeing 787).

**Time breakdown:** 6 lessons ≈ 5.5 h, project 3.5 h, checkpoint 1 h.

| # | Lesson | Interactions | Visual |
|---|---|---|---|
| 2.1 | Unsigned arithmetic is modular (`(unsigned char)250+10 → 4`) | PR, NP | V1 wheel, A2 |
| 2.2 | Two's complement: invert+1, asymmetric range, sign extension, casts reinterpret bits | NP, PR | V1, V2 |
| 2.3 | Promotions and usual arithmetic conversions; the `-1 < 3u` trap; `sizeof(x)-5 > 0` | PR, CE (`-Wsign-compare`), FB | V1 |
| 2.4 | Signed overflow is UB; `<stdint.h>`; in-browser UB trap build (`-fsanitize=undefined -fsanitize-trap=undefined`) | PR, FB | YT |
| 2.5 | `& \| ^ ~ << >>`, masks and flags; shift UB; division and `%` truncate toward zero; `-7>>1` | NP, CT bit puzzles | V1 |
| 2.6 | Digits and checksums: `%`/`/` digit extraction, Luhn, greedy change in integer cents | CT cash, credit | – |

- **Project:** Credit plus `bitlab`, 10 puzzles under operator restrictions (getByte, bitCount, isPowerOfTwo, absVal, …).
  - Credit: 30 numbers (AMEX/MASTERCARD/VISA/INVALID; 13/15/16 digits; Luhn-valid but wrong prefix).
  - bitlab: exhaustive 8-bit tests plus 10⁶ random and edge values (0, −1, INT_MIN, INT_MAX).
  - Built with the UB trap, so any signed overflow fails a test.
  - A token scanner enforces which operators each puzzle may use.
- **Checkpoint (12 items):** 4 NP, 3 PR, 2 FB (`(a+b)/2` overflow; `for (unsigned i=n-1; i>=0; i--)`), 1 CT, 2 CE/multiple choice.
- **Retrieval:** M1 (hex↔binary, sizeof, specifiers, loop tracing).
- **Resources:** CS:APP §2.2–2.3 "Integer Representations"/"Integer Arithmetic" (pp. 59–107); Effective C 2e ch. 3 "Arithmetic Types" (p. 47).
- **YouTube:** CS50 L1 `SlqjA04_dpk` 02:19:40–02:25:10 (integer overflow, Boeing 787, Pac-Man).
- **Criteria:** S7 (D), S4 (I: UB detection), S12 (cash, credit).
- **JS analogies:**
  - 2.2/2.5: `x|0`, `x>>>0`, `~~x` and `Math.imul` are exactly 32-bit two's complement. *Breaks:* JS `+` never wraps (2**31+1 is an exact double); C signed overflow is UB, not wraparound; C has 8/16/32/64-bit widths and silent conversions.
  - 2.4: `BigInt.asIntN(64,x)` behaves like int64 wraparound.
  - 2.5: bitmask APIs such as `compareDocumentPosition()` work like C flags. `Math.trunc(-7/2)` and JS `%` behave the same as C.

#### M3. Floating Point, Characters, Arrays & Strings — 12.5 h (2.5 wk) · browser, ending with the local-toolchain lab
**Why it matters:** Learners know `0.1+0.2`, not why. Text in C is raw bytes. Arrays are the first data shaped like memory.

**Time breakdown:** 6 lessons ≈ 7 h, project 4 h, checkpoint 1.5 h.

| # | Lesson | Interactions | Visual |
|---|---|---|---|
| 3.1 | IEEE-754 sign/exponent/fraction; float vs double; NaN/Inf; epsilon compares; int division `1/3 = 0` | NP (decode bits), PR | V1 IEEE, A3, YT |
| 3.2 | Chars are small ints: ASCII, `<ctype.h>`; char signedness differs by platform (A1) | PR, CT scrabble | V2 |
| 3.3 | Arrays: contiguous, `base+i*size`, no bounds checks (browser reads garbage silently), pass length explicitly, 2D row-major | MD, FB | V2 |
| 3.4 | Strings: NUL-terminated; `strlen` is O(n); `strcmp` vs `==`; +1 byte for `'\0'` | PR, CT readability | A4 |
| 3.5 | `argc/argv`, `strtol` with error checks, exit codes | CT caesar, substitution, wordle | – |
| 3.6 | **Lab: get your own compiler.** macOS `xcode-select --install`; Windows `wsl --install` then `apt install build-essential gdb valgrind`; run `repr.c` natively and diff against the browser (long/pointer 4→8) | PR "what changes?", `make doctor` token | V2 |

- **Project:** Substitution plus Readability (Wordle as an optional variant).
  - Readability: exact grade for 12 texts, including "Before Grade 1" and "Grade 16+".
  - Substitution: key validation (26 letters, alphabetic, no duplicates, else exit 1 with usage), case preserved, non-letters unchanged.
  - Must compile with `-Werror`.
- **Checkpoint (12 items):** 2 NP IEEE, 3 PR (float equality, char arithmetic, `sizeof` vs `strlen`), 1 MD string bytes, 1 PA caesar, 2 FB (missing `'\0'`, buffer off-by-one), 1 CT, 1 CE (`-Wsizeof-array-argument`), 1 toolchain token.
- **Retrieval:** M1 (specifiers), M2 (conversions, modular arithmetic → caesar).
- **Resources:** CS:APP §2.4 "Floating Point" (pp. 108–125); Beej ch. 6 "Arrays" and ch. 7 "Strings".
- **YouTube:** CS50 L1 02:25:10–02:29:40 (truncation, floating-point imprecision, Y2K/2038).
- **Criteria:** S7 (A floats), S3 (I), S1 (I/D native compile), S12 (scrabble, readability, caesar, substitution, wordle).
- **JS analogies:**
  - 3.1: `Number` is binary64, the same as C `double`; `Number.EPSILON` = `DBL_EPSILON`; `Math.fround` gives a `float`. *Breaks:* `5/2` is `2` in C.
  - 3.2: `charCodeAt` ≈ `s[i]`. *Breaks:* JS strings are UTF-16; a C `char` is a byte and UTF-8 characters span several.
  - 3.3: JS arrays. *Breaks:* C arrays are fixed size, have no `.length`, have no bounds check, and cannot be assigned.
  - 3.4: `.length` is O(1); string `===` compares content, while `==` on `char*` compares addresses.
  - 3.5: `process.argv`/`process.exit(1)` match `argv`/exit codes closely (Node's argv[0] is the node binary).

### PART II — THE MACHINE AND THE TOOLCHAIN

#### M4. The Machine: CPU, Memory & Instructions — 10 h (2 wk) · browser (TinyCPU), optional native `-S`
**Why it matters:** C only feels like a thin layer once the layer underneath is concrete. Registers and instructions explain pointers, calls and performance later.

**Time breakdown:** 5 lessons ≈ 5 h, project 4 h, checkpoint 1 h.

| # | Lesson | Interactions | Visual |
|---|---|---|---|
| 4.1 | Memory is one byte array; addresses are indices; word loads are little-endian; a C pointer is a number (A4 FFI demo: `65536`) | PR | V2, V7 |
| 4.2 | Fetch–decode–execute: registers, PC, instruction encoding; **write the decode loop in C** (switch plus shifts/masks from M2) | SS, CT | A5, V7 |
| 4.3 | Control flow = compare + conditional branch; hand-compile `if/while/for` | PA, SS | V7 |
| 4.4 | Functions = call/ret + SP + return address; argument registers; caller- vs callee-saved; recursive factorial; stack overflow | SS, MD (3 frames) | V7, V3-lite, A8 preview |
| 4.5 | Real machines: the same `sum` in x86-64 / arm64 / wasm (A5 listings); why the browser is a stack machine | AS | precomputed listings, optional `clang -O1 -S` |

- **Project:**
  - (a) TinyCPU emulator core in C (`uint8_t mem[65536]`, decode by bit fields, dispatch with switch).
  - (b) TinyCPU programs: sum array, max, strlen, recursive factorial.
  - Runner: golden per-step register/memory traces on 20 programs; final state; instruction budget; check that the stack is balanced.
- **Checkpoint (10 items):** 3 SS, 2 AS, 1 PA, 1 MD, 1 CT (decode function), 2 multiple choice.
- **Retrieval:** M2 (masks/shifts), M3 (arrays as base+offset), M1 (hex).
- **Resources:** CS:APP 3e ch. 1 §1.1–1.4 (pp. 1–10); Nand2Tetris (*The Elements of Computing Systems*, 2e) ch. 4 "Machine Language" and ch. 5 "Computer Architecture" (Projects 4–5).
- **YouTube:** none (CS50 doesn't cover this); A5 fills the gap.
- **Criteria:** S8 (I/D), S9 (I), S2 (I).
- **JS analogies:**
  - 4.2: the event loop ≈ the fetch–decode–execute loop. *Breaks:* the CPU doesn't wait on tasks; interrupts are hardware events.
  - 4.4: the DevTools call stack ≈ the machine stack. *Breaks:* closures keep variables alive after return; C locals die on return.
  - 4.5: V8 Ignition bytecode and wasm are virtual ISAs. *Breaks:* real ISAs have a finite register file and addressing modes.
  - 4.1: `DataView.getUint32(o, true)` is exactly a little-endian load.

#### M5. From Source to Process: Preprocess, Compile, Assemble, Link, Load — 12.5 h (2.5 wk) · browser (V8) then native
**Why it matters:** Front-end engineers live inside bundlers. Linker and header errors are the main frustration for C newcomers. This module covers S1 and S11.

**Time breakdown:** 6 lessons ≈ 6.5 h, project 4.5 h, checkpoint 1.5 h.

| # | Lesson | Interactions | Visual |
|---|---|---|---|
| 5.1 | Four stages: `-E`, `-S`, `-c`, link; the `-v` driver | PR (last line of `main.i`), CE | A6, V8, YT |
| 5.2 | Preprocessor: textual `#include`, macros and their pitfalls, conditional compilation, include guards | PR, FB (double include, unparenthesized macro) | V8 |
| 5.3 | Object files and symbols: declaration vs definition, `extern`, `static` (`t` vs `T` in `nm`), undefined/duplicate symbols, relocation | CE: the same error from wasm-ld, GNU ld (`undefined reference`) and Apple ld (`Undefined symbols for architecture arm64`) | A7, V8 |
| 5.4 | Libraries: `ar` (.a), .so/.dylib, `-I -L -l`, link order, loader and dynamic linker, `ldd` / `otool -L` | native task | – |
| 5.5 | Make: targets, prerequisites, pattern rules, `.PHONY`, timestamps, `-MMD -MP`, `make -n` | PA Makefile, CT | – |
| 5.6 | C ABI, "same code, different machine": ILP32 vs LP64, char signedness, long double; calling conventions (preview of M6); call C from JS via wasm exports; native `dlopen` | CT (export a function the lesson's JS calls) | V2 |

- **Project — "Modularize & ship `libtext`":** refactor the M3 code into `text.h/.c` and `cipher.h/.c` plus drivers; static library; Makefile (`all/test/clean`, dependency tracking).
  - Clean build with `-Werror`.
  - After `touch src/cipher.c`, `make -n` must rebuild only `cipher.o` and relink.
  - `nm libtext.a` must export exactly the public API.
  - Each header must compile standalone and when included twice.
  - Unit tests pass and exit codes are correct.
- **Checkpoint (12 items):** 2 PR, 3 CE (classify as compile, link or load error), 1 symbol-resolution drag task (V8), 1 PA, 1 FB (missing `static` → duplicate symbol), 2 multiple choice, 1 runner token.
- **Retrieval:** M3 (argv, strings), M4 (calls), M2 (widths).
- **Resources:** CS:APP 3e ch. 7 "Linking" §7.1–7.10 (pp. 671–700); Effective C 2e ch. 10 "Program Structure" (p. 213).
- **YouTube:** CS50 L2 `h5Gc1n8ZuU8` 00:48:00–00:57:30, pausing at 00:51:30 (preprocessing, compiling, assembling, linking).
- **Criteria:** S1 (D/A), S11 (D/A), S9 (D).
- **JS analogies:**
  - 5.1: tsc → bundler → minifier ≈ the four stages. *Breaks:* linkers patch machine addresses through relocations.
  - 5.3: ES `import/export` ≈ header declarations plus external linkage; a non-exported module binding ≈ `static`. *Breaks:* `#include` pastes text; there is no module scope, no namespaces, and macros leak.
  - 5.4: tree shaking ≈ `--gc-sections`/dead stripping; an npm package ≈ a library. *Breaks:* no semver resolver, and ABI compatibility matters.
  - 5.5: package.json scripts ≈ a Makefile. *Breaks:* Make is a dependency graph driven by timestamps.
  - 5.6: `WebAssembly.instantiate` exports ≈ `dlopen/dlsym`.

#### M6. Machine-Level C: Control Flow, Procedures & the Debugger — 12.5 h (2.5 wk) · native (precomputed listings in the browser)
**Why it matters:** This covers S9 and the debugger, and demystifies the stack before pointers. Bomb-lab-style puzzles engage experienced engineers.

**Time breakdown:** 5 lessons ≈ 6 h, project 5 h, checkpoint 1.5 h.

| # | Lesson | Interactions | Visual |
|---|---|---|---|
| 6.1 | x86-64 and arm64 essentials: registers, mov/ldr/str, add/lea, operand sizes, `(%rdi,%rsi,8)` = array index; `-O0` vs `-O1`; `objdump -d` / `otool -tV` | AS, PR | listing viewer |
| 6.2 | Branches: cmp/test + jcc / b.cond; loops; switch → jump table; **jl vs jb = signed vs unsigned (M2)** | AS, PA | – |
| 6.3 | Procedures: call/ret/bl; SysV AMD64 (rdi, rsi, rdx, rcx, r8, r9 → rax) vs AAPCS64 (x0–x7 → x0); frames; 16-byte alignment | SS, MD | A8, V3 frames |
| 6.4 | Recursion on the machine; stack overflow (`ulimit -s`); browser contrast: 64 KiB stack traps (A3) | PR, DB | V3 |
| 6.5 | gdb ↔ lldb: break, step, finish, bt, frame, print, `x/4xb`, disassemble, register read; DWARF (`-g`) | DB | – |

- **Project — "Defuse":** learners receive a precompiled `phases.o` (x86-64 ELF, arm64 Mach-O, x86-64 Mach-O) plus `main.c`. They **link it themselves**, which reinforces M5 and avoids distributing code-signed executables (the linker ad-hoc-signs locally on Apple Silicon; from docs, not verified here). They then defuse 5 phases by reading disassembly: string compare, arithmetic loop, jump table, recursion, linked nodes. Browser recursion exercises (recursive atoi, digit sum) run alongside.
  - Runner: `make check` runs `./bomb answers.txt` and expects all phases defused.
  - Answers are seeded per learner, which also yields the completion token.
- **Checkpoint (10 items):** 3 AS (learner picks their ISA), 2 SS, 2 items interpreting real bt/frame output, 1 MD, 1 PR, 1 defuse token.
- **Retrieval:** M4 (TinyCPU stack), M5 (linking `.o`), M2 (signedness → branch choice).
- **Resources:** CS:APP 3e §3.4–3.7 (pp. 179–254) and §3.10.2 "Using the gdb Debugger" (p. 279); CMU 15-213 Fall 2015 Lecture 6 "Machine Prog: Control" and Lecture 7 "Machine Prog: Procedures" (Panopto, linked from the course schedule).
- **YouTube:** none.
- **Criteria:** S9 (D/A), S8 (D), S4 (I/D debugger), S11 (D calling convention).
- **JS analogies:**
  - 6.5: DevTools step over/into/out and the Call Stack pane ≈ next/step/finish/bt. *Breaks:* raw memory and registers are visible; variables can be "optimized out"; a crash is a signal, not an exception.
  - 6.5: source maps ≈ DWARF (a close match).
  - 6.4: `RangeError: Maximum call stack size exceeded` ≈ stack overflow. *Breaks:* C gets SIGSEGV, which can't be caught, and the limit is in bytes, not frames.

### PART III — MEMORY & DATA LAYOUT (native-first)

#### M7. Pointers & the Memory Map — 15 h (3 wk)
**Why it matters:** This is the core of S2, S3 and S4. The audience has never managed memory.

**Time breakdown:** 6 lessons ≈ 7.5 h, project 6 h, checkpoint 1.5 h.

| # | Lesson | Interactions | Visual |
|---|---|---|---|
| 7.1 | `&`, `*`, pointer types, NULL, `%p`; swap; a pointer is just a register holding a number | MD, PR | V4, V3, YT |
| 7.2 | Pointer arithmetic scales by sizeof (matches `lea …,8`); array decay; `a[i] ≡ *(a+i)`; `const char *` | PR, MD, PA | V4, V2 |
| 7.3 | Memory map: text/rodata/data/bss/heap/stack; storage duration; print addresses; `/proc/self/maps` or `vmmap`; browser contrast (A3 layout, code not addressable) | MD ("where does each of 20 variables live?"), PR | A9, YT |
| 7.4 | `malloc/calloc/realloc/free`; `sizeof *p`; NULL checks; ownership; **reimplement CS50's `get_string` as `get_line()` with realloc doubling** | SS, CT | A10, V3 heap |
| 7.5 | Bug taxonomy (CS:APP §9.11) with ASan/UBSan, Valgrind (Linux/WSL), `leaks` (macOS); gdb watchpoints; "the browser lies" (A3) | FB (6 symptom-only bugs), CE (sanitizer reports) | – |
| 7.6 | `char **argv`, dynamic 2D arrays, pointer-to-pointer to modify the caller's pointer | MD, CT | V4 |

- **Project — `strlib` + bug zoo:** `str_dup`, `str_cat_alloc`, `str_split` (returns `char**`), `str_join`, `get_line(FILE*)`; then fix 6 programs using only their symptoms and sanitizer output.
  - Unit tests include empty input and lines over 64 KiB (forces realloc).
  - Built with `-fsanitize=address,undefined -g`, and also plain under `valgrind --leak-check=full --error-exitcode=1` (Linux) or `leaks --atExit` (macOS).
  - Zero leaks; each fixed bug-zoo program passes its regression test.
- **Checkpoint (14 items):** 4 MD, 3 PR (pinned to LP64), 2 SS, 2 CE sanitizer reports, 1 FB, 1 CT, 1 token.
- **Retrieval:** M3, M6 (frames), M5 (static storage), M2 (sizes).
- **Resources:** K&R 2e ch. 5 "Pointers and Arrays"; CS:APP §9.11 "Common Memory-Related Bugs in C Programs" (pp. 870–875).
- **YouTube:** CS50 L4 `db0H0U13YsA` 01:27:40–01:30:40 (Binky) and 01:40:00–01:45:00 (memory layout and swap).
- **Criteria:** S2 (D/A), S3 (D/A), S4 (D/A).
- **JS analogies:**
  - 7.1: object references ≈ pointers. *Breaks:* JS has no `&`, no arithmetic, no pointer to a local, and GC frees memory; JS `null.x` throws, while C is UB (segfault natively, silent 0 in wasm).
  - 7.2: "a pointer is an index into one giant Uint8Array" (verified in A4). *Breaks:* native memory is virtual, with unmapped pages and protections.
  - 7.5: detached-DOM leaks and heap snapshots ≈ leak reports. *Breaks:* every C allocation leaks unless freed, and double free / use-after-free have no JS equivalent.
  - 7.6: JS cannot rebind a caller's variable; C can, through `**`.

#### M8. Structs, Layout, Endianness & Binary Files — 15 h (3 wk) · native, browser byte viewer
**Why it matters:** Real binary formats (audio, images) connect to the Canvas `ImageData` and ArrayBuffer knowledge the audience already has. Covers S7 endianness and S3 structs and files.

**Time breakdown:** 7 lessons ≈ 7 h, project 6.5 h, checkpoint 1.5 h.

| # | Lesson | Interactions | Visual |
|---|---|---|---|
| 8.1 | Structs, typedef, `->`, value semantics, arrays of structs | PR, CT | V2 |
| 8.2 | `offsetof`, padding, reorder to shrink (12→8; `{char,void*}` 8 vs 16), `_Alignof`, packed attribute | PR (per platform), MD byte map | V2, A11 |
| 8.3 | Endianness (all targets little-endian; network order is big-endian); portable byte assembly; unions vs `memcpy` punning | PR, NP | V2 |
| 8.4 | stdio files: modes, `fread/fwrite/fseek/ftell`, check every count, buffering (preview of M12) | CT, FB (no `"b"`, ignored `fread` count) | – |
| 8.5 | WAV: 44-byte header, int16 samples, scale and clamp | CT (Volume) | V2 |
| 8.6 | BMP: packed header structs, BGR, bottom-up rows, 4-byte row padding; grayscale/sepia/reflect/blur (copy buffer)/Sobel edges | CT, FB | V2 |
| 8.7 | Forensics: JPEG signature `ff d8 ff e?` (mask `0xf0`), 512-byte blocks, recovery state machine, `sprintf("%03i.jpg")` | CT | – |

- **Project:** Filter (less or more) plus Recover, with Volume as a required exercise.
  - Filter: pixel-exact output on 6 original reference images (padding widths, 1×1, 3×3).
  - Recover: SHA-256 of the 50 JPEGs recovered from our own forensic image.
  - Volume: sample-exact on 3 WAVs, including clipping.
  - ASan/UBSan clean, no leaks, usage errors exit 1.
- **Checkpoint (12 items):** 3 MD byte maps (LP64 vs wasm32), 2 PR, 2 NP (hex dump of a BMP header), 2 FB (in-place blur; missing padding skip), 1 CT, 2 multiple choice.
- **Retrieval:** M7, M2 (masks), M4 (little-endian), M3.
- **Resources:** CS:APP §3.8–3.9 (pp. 255–275, including §3.9.3 Data Alignment); Effective C 2e ch. 8 "Input/Output" (pp. 167–193).
- **YouTube:** none.
- **Criteria:** S3 (A), S7 (A endianness), S2 (D), S10 (I file I/O).
- **JS analogies:**
  - 8.1: a TS interface ≈ a struct. *Breaks:* fixed layout with padding, no dynamic properties, and assignment copies the struct.
  - 8.3: `DataView.getUint16(o, le)` is exact, and makes endianness explicit where C does not.
  - 8.6: `ImageData.data` ≈ BMP pixels. *Breaks:* BMP is BGR, bottom-up and padded; `uint8_t` wraps where `Uint8ClampedArray` clamps.
  - 8.7: `File.slice()` / `arrayBuffer()` ≈ reading fixed-size blocks.

### PART IV — ALGORITHMS & DATA STRUCTURES

#### M9. Searching, Sorting, Recursion & Complexity — 15 h (3 wk) · browser drills, native timing
**Why it matters:** CS50 Week 3 parity (S6), plus measuring on real hardware.

**Time breakdown:** 6 lessons ≈ 7 h, project 6.5 h, checkpoint 1.5 h.

| # | Lesson | Interactions | Visual |
|---|---|---|---|
| 9.1 | Linear vs binary search; O/Ω/Θ; overflow-safe midpoint `lo+(hi-lo)/2` | PR, CT, FB | – |
| 9.2 | Selection, bubble (early exit), insertion; best/worst case; stability | SS, PA | V3 array mode |
| 9.3 | Recursion and merge sort; recursion tree; heap buffer | SS, CT | A12, YT |
| 9.4 | Function pointers, `qsort`/`bsearch`, `void*` comparators | CT, CE (incompatible pointer type) | – |
| 9.5 | Measuring: `timespec_get`, doubling experiments, log–log plots; **Sort pset** with 3 compiled sorts provided (wasm in browser plus native) | PR, data task | chart |
| 9.6 | Elections: plurality, runoff (2D preference array), Tideman (pairwise strengths, sorted pairs, lock without cycles via DFS) | CT | V4 graph |

- **Project:** Plurality + Runoff (or Tideman) + Sort answers.
  - Function-level tests compile the student file with `-Dmain=student_main` plus a harness, as check50 does: `vote`, `tabulate`, `print_winner`, `find_min`, `is_tie`, `eliminate`.
  - Tideman: `add_pairs`, `sort_pairs`, `lock_pairs` (direct, 3-cycle and indirect cycles).
  - Merge sort must sort 10⁶ ints within a time budget and be stable on records.
- **Checkpoint (12 items):** 3 PR / Big-O classification, 2 SS, 1 PA, 2 FB (binary-search infinite loop; `return a-b` comparator overflowing at INT_MIN), 2 CT, 2 multiple choice.
- **Retrieval:** M7 (`void*`), M8 (structs), M6 (recursion frames), M2 (overflow).
- **Resources:** Erickson, *Algorithms* ch. 1 "Recursion" and ch. 6 "Depth-First Search"; K&R 2e §5.11 "Pointers to Functions" (p. 118).
- **YouTube:** CS50 L3 `6Svu_ae5ebk` 01:49:00–01:58:00, pausing at 01:54:00 (merge sort, n log n).
- **Criteria:** S6 (D/A), S3 (D), S12 (sort, plurality, runoff, tideman).
- **JS analogies:**
  - 9.4: `arr.sort(cmp)` ≈ `qsort`. *Breaks:* comparators receive `void*`; there are no closures (`qsort_r` is non-standard); `qsort` isn't guaranteed stable, while V8's TimSort is.
  - 9.1: `includes` vs `Set.has`.
  - 9.5: `performance.now()`. *Breaks:* browser timer precision is deliberately reduced.

#### M10. Linked Data Structures: Lists, Stacks, Queues, Trees, Tries — 15 h (3 wk)
**Why it matters:** S5, where heap memory and pointers combine. CS50 Week 5.

**Time breakdown:** 6 lessons ≈ 7 h, project 6.5 h, checkpoint 1.5 h.

| # | Lesson | Interactions | Visual |
|---|---|---|---|
| 10.1 | Abstract data types: opaque types in headers, create/destroy pairs, documented ownership | PR, PA | – |
| 10.2 | Singly linked lists: push, append, find, delete, free-all (read `next` first), pointer-to-pointer insert | MD, SS, FB (use-after-free) | A13, V4, YT |
| 10.3 | Stack (array), queue (circular buffer), list-backed versions, amortized doubling | CT | V3 |
| 10.4 | BST: insert, search, delete, traversals, degeneration, free in post-order | MD, SS, CT | A13, V4 |
| 10.5 | Tries: child arrays, memory cost arithmetic, O(L) lookup | CT, PR (bytes used) | V4, YT |
| 10.6 | Inheritance: recursive create/free of a family with seeded `rand` | CT | V3 |

- **Project:** Inheritance plus `dslib` (list, stack, queue, BST, trie).
  - Unit tests plus 10⁵-operation randomized differential tests against a reference implementation.
  - ASan/UBSan clean, and Valgrind/`leaks` report zero leaks after destroy.
  - BST timing on sorted vs random keys must show degeneration.
  - Inheritance structure checked with a fixed seed; `free_family` must be leak-free.
- **Checkpoint (12 items):** 4 MD, 2 SS, 2 FB (lost head pointer; leak in delete), 2 CT, 2 multiple choice.
- **Retrieval:** M7, M9, M8, M6.
- **Resources:** K&R 2e §6.5 "Self-referential Structures" (p. 139); CS50x 2026 Lecture 5 notes.
- **YouTube:** CS50 L5 `PmAI76OGE_E` 01:34:10–01:41:00 (linked lists) and 02:53:50–03:01:00 (tries).
- **Criteria:** S5 (A: lists, stacks, queues, BST, trie), S3 (A), S4 (D), S12 (inheritance).
- **JS analogies:**
  - 10.2: linked JS objects ≈ nodes. *Breaks:* you free each node in the right order, with no GC.
  - 10.1: `#private` class fields ≈ opaque types. *Breaks:* no methods or `this`; the pointer is passed explicitly.
  - 10.3: `push/pop/shift` ≈ stack/queue. *Breaks:* naive `shift` is O(n), a circular buffer is O(1), and nothing resizes automatically.
  - 10.4: DOM traversal ≈ tree recursion.

#### M11. Hash Tables & the Memory Hierarchy — 15 h (3 wk)
**Why it matters:** S5 hash tables plus S8 caches. This is where the bottom-up approach pays off: it explains why structures with the same O(1) differ ~10× in wall-clock time. Speller parity.

**Time breakdown:** 6 lessons ≈ 7 h, project 6.5 h, checkpoint 1.5 h.

| # | Lesson | Interactions | Visual |
|---|---|---|---|
| 11.1 | String hashing (djb2, FNV-1a), distribution, `& (2^k-1)` vs `%` | PR, CT | V5, A15, YT |
| 11.2 | Chaining vs linear probing, tombstones, load factor, rehash | SS (predict bucket/probe) | V5 |
| 11.3 | Hierarchy, latency numbers, 64-byte lines, temporal/spatial locality | multiple choice, PR | A14 |
| 11.4 | Direct-mapped and set-associative caches, tag/set/offset with bit ops, LRU | SS (hit/miss), NP (address split) | V6 |
| 11.5 | Access patterns: row vs column (A6), pointer chasing, AoS vs SoA, chaining vs probing; `perf stat` (Linux) | PR (direction and order of magnitude), measuring | V6 |
| 11.6 | Speller clinic: load/check/size/unload contract, case folding, apostrophes, `getrusage` timing | CT | – |

- **Project:** Speller plus `cachesim`.
  - Speller follows the CS50-parity contract and output (misspelled words, WORDS MISSPELLED / IN DICTIONARY / IN TEXT, TIME IN load/check/size/unload/TOTAL), using our own word list and public-domain texts.
  - `cachesim`: trace-driven, `-s -E -b`, LRU.
  - Runner: exact speller output on about 25 texts with small and large dictionaries; ASan/UBSan and Valgrind/`leaks` clean; benchmark compared with a staff reference time.
  - `cachesim` hits/misses/evictions must match on 8 traces.
- **Checkpoint (12 items):** 2 V5, 3 V6, 1 NP, 2 PR, 1 FB (resize without rehash), 1 CT, 2 multiple choice.
- **Retrieval:** M10 (chaining lists, tries), M2 (set-index bits), M8 (row-major), M9 (Big-O vs wall clock).
- **Resources:** CS:APP §6.2–6.6 (pp. 604–647); K&R 2e §6.6 "Table Lookup" (p. 143).
- **YouTube:** CS50 L5 02:38:20–02:50:20, pausing at 02:46:10 (hashing, hash tables).
- **Criteria:** S5 (A), S8 (A), S6 (D), S12 (speller).
- **JS analogies:**
  - 11.1: `Map`/`Set` ≈ hash tables. *Breaks:* in C you choose the hash function, collision handling, resize policy and key ownership (`strdup`), and keys compare with `strcmp`.
  - 11.3: CDN caching and memoization ≈ CPU caches. *Breaks:* hardware caches are transparent fixed-size sets of 64-byte lines with set conflicts, and spatial locality has no HTTP equivalent.
  - 11.5: TypedArray loops show the same row/column effect in browser JS.

### PART V — THE OS

#### M12. Processes, System Calls, Files & Virtual Memory — 15 h (3 wk) · native, POSIX
**Why it matters:** S10. The audience uses Node `fs` and `child_process` daily; this shows what sits underneath.

**Time breakdown:** 6 lessons ≈ 7 h, project 6.5 h, checkpoint 1.5 h.

| # | Lesson | Interactions | Visual |
|---|---|---|---|
| 12.1 | User vs kernel mode; syscall trap; libc wrappers; errno/perror; `strace` shows printf → write(1,…) | PR (count write calls: tty vs pipe), DB | A16 |
| 12.2 | File descriptors 0/1/2; open/read/write/close/lseek/stat; stdio buffering vs raw (benchmark buffer sizes from 1 B to 64 KiB) | CT (`mycat`, `mycp`), PR | – |
| 12.3 | fork / exec / waitpid, exit status, zombies, orphans | SS (deterministic fork variants), PR | A16 |
| 12.4 | pipe, dup2, how shells implement `<`, `>`, `\|`; environment | MD (fd-table fill-in), CT | – |
| 12.5 | Signals briefly: SIGINT, SIGSEGV, SIGCHLD | PR | – |
| 12.6 | Virtual memory: pages, page tables, TLB, faults, protection (explains why NULL segfaults natively but not in wasm), copy-on-write fork, mmap, brk vs mmap in malloc | MD (translate an address) | A17, V6 address split |

- **Project — minishell:** prompt, argv parsing, `cd` and `exit`, fork + execvp + waitpid, `$?`, `<` and `>` via open + dup2, a single `|`.
  - Runner feeds scripted sessions and diffs stdout/stderr/exit codes against `/bin/sh`.
  - No zombies (checked with `ps`), no fd leaks (`/proc/self/fd` on Linux, `lsof` on macOS), ASan clean.
  - Also reports the `mycat` buffer-size benchmark table.
- **Checkpoint (12 items):** 3 PR (including printf-before-fork duplicate output), 2 MD, 2 FB (unclosed pipe end → hang; zombie), 1 CT, 2 multiple choice, 2 short answers.
- **Retrieval:** M5 (loader, exec), M7 (memory map → address space), M8 (FILE*), M11 (TLB as a cache), M6 (call vs trap).
- **Resources:** OSTEP ch. 5 "Process API" and ch. 39 "Files and Directories"; CS:APP §9.1–9.6 (pp. 803–824).
- **YouTube:** none.
- **Criteria:** S10 (A), S2 (A), S1 (A load), S8 (D).
- **JS analogies:**
  - 12.2: `fs.openSync` returns the same kernel fd number (exact).
  - 12.3: `child_process.spawn` ≈ fork + exec + wait. *Breaks:* fork (duplicating a running process copy-on-write) has no JS equivalent.
  - 12.1/12.6: the browser mediating Web APIs ≈ the kernel mediating hardware; site isolation ≈ process isolation. *Breaks:* the browser is a policy layer on top of OS processes, not a kernel.
  - 12.4: stream backpressure ≈ pipes. *Breaks:* pipes have a fixed kernel buffer and block the writer.

---

## E. Capstone — "Write your own malloc, then run your speller on it" — 20 h (4 wk) · native

**Milestones:**
1. Implicit free list with boundary tags, first-fit, split and coalesce (CS:APP §9.9.6–9.9.12), on a region from `mmap` (portable to macOS), 16-byte aligned. The `size|alloc` bit packing reuses M2.
2. Explicit or segregated free lists; in-place `mm_realloc`; `mm_calloc`.
3. `mm_check()` heap checker: alignment, header/footer agreement, no adjacent free blocks, free-list consistency.
4. Link the M11 speller against the allocator through a compile-time shim header. Run-time interposition (CS:APP §7.13, `LD_PRELOAD`) is a Linux/WSL stretch goal.
5. Report: utilization and throughput vs libc; speller timing on your allocator vs the system allocator; optional `perf stat` cache misses.

**Runner:** about 12 traces in malloclab style (random, binary-tree, realloc-heavy, coalescing-adversarial, and a recorded speller trace).
- Payload ranges must never overlap.
- Pattern-written payloads must be preserved, including across realloc.
- Alignment of 16.
- `mm_check` must pass after every operation in debug builds.
- Pass thresholds for utilization (peak payload ÷ heap size) and relative throughput.
- Speller output must be identical on your allocator.
- End-of-run accounting must show no live blocks.

**Why it's harder than speller:** it combines raw-byte pointer arithmetic, bit packing, alignment, syscalls, linking/interposition, invariant debugging (gdb plus checker) and performance work. It touches S1–S11.

**Alternative track, "Speller++":** compare a hash table, a trie and a sorted array with binary search; cache-aware open addressing; an arena allocator; an `mmap`-ed dictionary; a perf-counter report.

**Final checkpoint:** 20 cumulative items covering every interaction type, the capstone runner token, and a self-assessed design document.

**Resources:** CS:APP §9.9 "Dynamic Memory Allocation" (pp. 839–864); OSTEP ch. 17 "Free Space Management".

**Animation:** A18.

**JS analogy:** V8's heap and GC does this for you. *Breaks:* C cannot compact or move blocks, because pointers are raw addresses.

---

## F. Success criteria → module coverage

I = introduced, D = developed, A = assessed.

| Criterion | M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8 | M9 | M10 | M11 | M12 | Cap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 source→process | I | | D | | **A** | D | | | | | | **A** | D |
| S2 memory layout | | | | I | | D | **A** | D | | | | **A** | D |
| S3 pointers/arrays/strings/structs/heap | | | I | | | | **A** | **A** | D | **A** | D | | **A** |
| S4 debugger + ASan/Valgrind | | I | | | | D | **A** | D | | D | D | D | **A** |
| S5 DS from scratch | | | | | | | | | | **A** | **A** | | D |
| S6 Big-O, sort/search | | | | | | | | | **A** | D | D | | |
| S7 bin/hex/2's comp/float/endian/bitwise | I | **A** | **A** | D | | | | **A** | | | D | | D |
| S8 CPU, registers, caches, access patterns | | | | **A** | | D | | | D | | **A** | D | D |
| S9 read asm from own C | | | | I | D | **A** | D | | | | | | |
| S10 syscalls, files, processes, OS | | | | | | | | I | | | | **A** | D |
| S11 multi-file, Make, headers, ABI | | | | | **A** | D | D | D | D | D | D | D | **A** |
| S12 CS50 parity | ✓ | ✓ | ✓ | | | | | ✓ | ✓ | ✓ | ✓ | | |

## G. CS50x 2026 problem-set parity

| CS50 pset | Our equivalent | Module | What we add on top |
|---|---|---|---|
| Hello, World / Hello, It's Me | 1.1 CT hello, hello-me | M1 | Real clang errors; input via our own fgets helper, later reimplemented as `get_line` in M7 |
| Mario less / more | M1 project (both) | M1 | Plus `bits` printer |
| Cash / Credit | 2.6 cash; M2 project credit | M2 | Integer cents, built with UB trap; plus bitlab |
| Scrabble | 3.2 CT | M3 | Char signedness by platform |
| Readability | M3 project | M3 | float/rounding from 3.1 |
| Caesar / Substitution | 3.5 caesar; M3 project substitution | M3 | Modular arithmetic from M2 |
| Wordle (older CS50 editions; client-requested) | 3.5 / optional variant | M3 | – |
| Sort | 9.5 (wasm and native binaries) | M9 | log–log measurement |
| Plurality / Runoff / Tideman | M9 project | M9 | Function-level harness; DFS cycle check |
| Volume | 8.5 (required) | M8 | Clamping |
| Filter less / more | M8 project | M8 | Padding and endianness via V2 |
| Recover | M8 project | M8 | SHA-256-verified output |
| Inheritance | M10 project | M10 | Leak-checked |
| Speller | M11 project | M11 | + cachesim; capstone reruns it on your own malloc |

Practice problems map as follows:

| CS50 practice problem | Our module / lesson |
|---|---|
| Debug, Half, Prime | M1 |
| Hours, N0 V0w3ls, Password | M3 |
| Recursive atoi | M6 |
| Average Temperatures, Max, Snackbar | M9 |
| Bottom Up, License | M8 |
| Trie | M10.5 |

**G2. CS50 lecture topics → modules:**

| CS50 week | Topics | Our modules |
|---|---|---|
| Week 1 | types, operators, integer overflow, floating-point imprecision | M1–M3 |
| Week 2 | preprocessing/compiling/assembling/linking, debugging, arrays, strings, argv, exit status, cryptography | M3, M5, M6 |
| Week 3 | searching, sorting, O/Ω/Θ, recursion, structs | M8, M9 |
| Week 4 | hex, pointers, segfaults, dynamic memory, stack/heap, buffer overflow, file I/O, images, valgrind, garbage values, swap, scanf | M1, M7, M8, M12 |
| Week 5 | ADTs, queues, stacks, linked lists, trees, BSTs, hash tables, tries | M10, M11 |

## H. Further study (not covered properly here)

- Concurrency: OSTEP ch. 26–32; CS:APP ch. 12
- Networking: CS:APP ch. 11
- Pipelined CPUs: CS:APP ch. 4; Nand2Tetris Projects 1–5
- Optimization: CS:APP ch. 5
- Virtual memory internals: OSTEP ch. 18–23; CS:APP §9.7–9.8
- Signals and setjmp: CS:APP §8.5–8.6
- Exploits and mitigations: CS:APP §3.10.3–3.10.4
- PIC/GOT/PLT: CS:APP §7.10–7.12
- Floating-point assembly: CS:APP §3.11
- Garbage collection: CS:APP §9.10 (a bridge back to JS engines)
- File systems: OSTEP ch. 40, 42
- C23: Effective C 2e appendix; Modern C 3e
- Fuzzing, static analysis and CMake
- Compilers: Nand2Tetris ch. 10–11

## I. Total length

| Module | M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8 | M9 | M10 | M11 | M12 | Cap | **Total** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hours | 10 | 10 | 12.5 | 10 | 12.5 | 12.5 | 15 | 15 | 15 | 15 | 15 | 15 | 20 | **177.5 h** |
| Ends at week | 2 | 4 | 6.5 | 8.5 | 11 | 13.5 | 16.5 | 19.5 | 22.5 | 25.5 | 28.5 | 31.5 | 35.5 | **≈36 weeks** |

All CS50 C psets are done by week ≈28.5.

**Trade-off of this angle:** pointers arrive around week 14 (CS50 reaches them in Week 4). By then, addresses, frames and `lea` scaling are familiar, so pointers become notation for something already known. Motivation is kept up by shipping CS50 psets in M1–M3.

## J. Implications for the verification pipeline (from section A)

1. Store expected outputs per platform: wasm32, linux-x86_64, and macos-arm64. macOS needs a CI runner, or items must avoid char signedness, `long double` and `sizeof(long)` dependencies.
2. Normalize `%p` addresses, timings, PIDs and fork interleavings.
3. Store compiler-error items per compiler (clang 22 browser, gcc 13/Ubuntu 24.04 WSL, Apple clang). Run CI with both gcc and clang.
4. Never take answers for UB samples from the browser. Use the browser UB-trap build (`-fsanitize=undefined -fsanitize-trap=undefined`) only as an alarm.
5. Link browser builds with `-Wl,-z,stack-size=8388608` so recursion behaves like native.
6. V8 (the Build Pipeline Panel) is feasible: `-E`, `-S`, `-c`, `nm` and link errors all work in the wasm toolchain.

**Scripts and samples** are in `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/bottom-up-outline/`:
- `scripts/`: `wrun.mjs`, `wflags.mjs`, `wpipe.mjs`, `wffi.mjs`, `srtfind.py`
- `samples/`: `repr.c`, `err.c`, `oob.c`, `ub.c`, `deep.c`, `sum.c`, `cache.c`, `signcmp.c`, `mario.c`
- `web/`: CS50 HTML pages and SRTs, the CS:APP preface TOC, the Effective C TOC, OSTEP and Beej pages.

Sources: [CS50x 2026](https://cs50.harvard.edu/x/), [CS50 psets](https://cs50.harvard.edu/x/psets/), [CS50 license](https://cs50.harvard.edu/x/license/), [CS:APP 3e](https://csapp.cs.cmu.edu/), [CMU 15-213 F15 schedule](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f15/www/schedule.html), [OSTEP](https://pages.cs.wisc.edu/~remzi/OSTEP/), [Effective C 2e](https://nostarch.com/effective-c-2nd-edition), [Beej's Guide to C](https://beej.us/guide/bgc/html/split/), [Nand2Tetris](https://www.nand2tetris.org/course), [Erickson Algorithms](https://jeffe.cs.illinois.edu/teaching/algorithms/), [K&R 2e (Pearson)](https://www.pearson.com/en-au/subject-catalog/p/c-programming-language/P200000000368/9780137460847), [K&R TOC listing](https://poincare.matf.bg.ac.rs/~maricm/CCC/Cvezbe/kandr.html), [Modern C 3e (S&S)](https://www.simonandschuster.com/books/Modern-C-Third-Edition/Jens-Gustedt/9781638357711), [Gustedt Modern C page](https://gustedt.gitlabpages.inria.fr/modern-c/).