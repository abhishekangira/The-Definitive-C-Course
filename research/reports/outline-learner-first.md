# Course outline: *The Definitive C Course*, ordered for front-end engineers

**At a glance:** 12 modules plus a capstone. That is **175 h ≈ 35 weeks at 5 h/week**, plus 2 optional flex weeks (about 37 calendar weeks).
- **Part I, C in the Browser (M1–M5), 60 h / 12 wk.** Nothing to install. CS50 Weeks 1–3 psets, plus the pointer and memory concepts from Week 4.
- **Part II, Native C (M6–M8), 45 h / 9 wk.** The learner installs a local toolchain in M6. Full CS50x C parity (Weeks 1–5) is reached at **week 21**, and the course marks it as a milestone.
- **Part III, Under the Hood (M9–M12), 50 h / 10 wk.** CPU and assembly, linking and the ABI, caches, operating system.
- **Capstone, 20 h / 4 wk.** Write your own `malloc`, then run your Speller and shell on it. An alternative track is "Speller Pro".

---

## 0. Verification log: what I ran and what I only read

Scratch root: `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/course-outline-learner/`. It holds `samples/*.c`, the runners in `wasm/`, `cs50/*.srt` and `books/`.

### 0.1 Ran myself

**Toolchains**
- **In browser (stand-in):** `@yowasp/clang@22.0.0-git20542-10`. The package unpacks to 105,501,358 bytes and the resource download is 105,241,285 bytes. It targets wasm32-wasi. I ran its output under Node v22.22.0 `node:wasi` (preview1).
- **Native:** gcc 13.3.0, Ubuntu clang 18.1.3, valgrind 3.22.0, GNU Make 4.3, strace, gdb, lldb.

**Compile speed and output size**
- Each compile took **≈850–1,180 ms** in Node once the toolchain was loaded.
- A small program produces a `.wasm` of **≈18 KB**: 17.9–18.6 KB, or 27.9 KB when it uses `malloc`.

The compile helper that worked (`wasm/compile.mjs`):
```js
import { runClang } from '@yowasp/clang';
const out = await runClang(['clang','-std=c17','-Wall','-Wextra','-pedantic', ...extra, name,'-o','prog.wasm'],
  { [name]: src }, { stdout: b => b && (diag += dec.decode(b)), stderr: b => b && (diag += dec.decode(b)) });
// run out['prog.wasm'] with new WASI({version:'preview1', returnOnExit:true}) in a SEPARATE process/worker
```
I ran one 64 MiB program in the same Node process as the compiler and Node segfaulted. The same program ran fine in its own process. Learner programs should run in their own Worker.

**Type sizes (`sizes.c`)**

| | char | short | int | long | long long | ptr | size_t | float | double | long double |
|---|---|---|---|---|---|---|---|---|---|---|
| wasm32 (YoWASP) | 1 | 2 | 4 | **4** | 8 | **4** | **4** | 4 | 8 | 16 |
| x86-64 (gcc/clang) | 1 | 2 | 4 | **8** | 8 | **8** | **8** | 4 | 8 | 16 |

**Where the browser behaves differently from native.** These results decide when the course moves to the local toolchain.

| Sample | wasm32 result | native x86-64 result |
|---|---|---|
| `*p` with `p = NULL` (read, then write 42) | prints `value at NULL: 0`, then `after write: 42`, exit 0 | **SIGSEGV, exit 139** after `before` |
| write to a string literal | prints `Jello` | **SIGSEGV, exit 139** |
| heap off-by-one write (`overflow.c`) | prints `0`, exit 0, silent | gcc `-fsanitize=address`: `heap-buffer-overflow … WRITE of size 4 … overflow.c:6 … 0 bytes after 12-byte region` |
| `-fsanitize=address` in the browser toolchain | **link fails**: `wasm-ld: error: undefined symbol: __asan_report_store4` … | works with gcc 13. clang 18 in this container fails because `libclang_rt.asan-x86_64.a` is missing |
| `-fsanitize=undefined -fsanitize-trap=undefined` in the browser toolchain | **works**. A NULL dereference, signed overflow, or out-of-bounds index on a fixed-size array → `RuntimeError: unreachable`. Heap overflow is **not** caught | n/a |
| `printf("score %d\n")` with the argument missing | `score 0` | `score 995982408` (gcc) / `948531992` (clang) |
| `long card = 4003600000000014;` | `-1009606642`, with clang warning `implicit conversion from 'long long' to 'long' changes value … [-Wconstant-conversion]` | `4003600000000014` |
| deep recursion, ~290-byte frames | default shadow stack: **≈200 frames**, then `RuntimeError: memory access out of bounds`. With `-Wl,-z,stack-size=8388608`: **≈13,000 frames**, then **`RangeError: Maximum call stack size exceeded`** | 8 MiB stack (`ulimit -s` 8192): >27,000 frames, then SIGSEGV |
| `#include <sys/wait.h>` | `fatal error: 'sys/wait.h' file not found` | fork/exec work |
| stdout and stderr redirected | syscall trace: `fd_write(fd=1,4 bytes)`, `fd_write(fd=2,4)`, `fd_write(fd=1,10)` | strace: `write(2,"err\n",4)`, then `write(1,"one\ntwo\nthree\n",14)` |
| use after free | `99` | `99`. Undefined behaviour that happens to agree |

**Same output on both targets**
- `bytes.c` (uint32 `0x01020304`) → `04 03 02 01`.
- `twos.c` → `-56 4294967295 2147483648 -4` and `0` for `-1 < 1u`.
- `floats.c` → `0 0.30000000000000004 16777216.0`.
- `strlen("e"), strlen("é")` → `1 2`.

**Struct layout and `sizeof` (`padding.c`, `strsize.c`)**
- `struct {char;int;char}` = 12 bytes on both targets, at offsets 0/4/8. Reordered as `{int;char;char}` it is 8.
- `struct Node {int; struct Node*}`: wasm32 size 8 with `next` at offset 4; x86-64 size 16 with `next` at offset 8.
- In `strsize.c`: `char word[]="hello"` has sizeof 6 and strlen 5 on both. `sizeof(char*)` and `sizeof` of an array parameter are 4 on wasm32 and 8 natively. Both compilers emit `-Wsizeof-array-argument`.

**Exact diagnostic texts captured (lesson material)**
- clang 22 and 18: `call to undeclared library function 'printf' with type 'int (const char *, ...)'; ISO C99 and later do not support implicit function declarations`. This is an **error**.
- gcc 13 gives only a **warning** for the same code: `implicit declaration of function 'printf'` plus `note: include '<stdio.h>'`.
- `-Wparentheses`, `-Wformat-insufficient-args` (clang) vs `-Wformat=` (gcc), `-Wsign-compare`, `-Winfinite-recursion`.
- Linker: `undefined reference to 'helper'` / `collect2: error: ld returned 1 exit status`, `multiple definition of 'counter'; … first defined here`, and clang's `linker command failed with exit code 1`.

**Cache experiment (4096×4096 int, row-major vs column-major traversal)**
- Native gcc: **4.3× at -O0, 17.2× at -O2** slower by column.
- wasm32 in Node: **7.1×**.
- Plain JS `Int32Array`: **4.3×**.
- CPU was a Xeon at 2.1 GHz with 48 KiB L1d per core.

**Assembly views**
- gcc emits x86-64 assembly (`-masm=intel`) on Linux.
- `clang --target=arm64-apple-macos13 -S` also works on Linux and shows `_sum`, `ldrsw x9,[x0],#4`, `b.ne`.
- Ubuntu gcc adds `endbr64` and a `.note.gnu.property` section. Use `-fcf-protection=none` for clean listings.

**OS-level checks (native)**
- `fork` test: parent and child both show `&shared=0x564af02e5010` but hold different values (1 and 2). That is virtual memory, demonstrated.
- Valgrind: `8 bytes in 1 blocks are definitely lost … by 0x…: dup (leak.c:3)`.

**JavaScript facts used as analogies**
- `Uint8Array` over `Uint32Array([0x01020304])` → `04 03 02 01`.
- `DataView.setUint32` with default endianness → `01 02 03 04`, i.e. big-endian.
- `(2**31)|0` = −2147483648, `-1>>>0` = 4294967295, `Math.fround(16777217)` = 16777216.
- `react-reconciler@0.31.0` `FiberNode` has `return`, `child` and `sibling` fields, which makes it a linked structure.

**CS50x 2026 (fetched with curl from cs50.harvard.edu)**

| Pset | Problems |
|---|---|
| 1 | Hello World, Hello It's Me, Mario less/more, Cash/Credit |
| 2 | Scrabble, Readability, Caesar/Substitution. **Wordle is not in the 2026 list** |
| 3 | Sort, Plurality, Runoff/Tideman |
| 4 | Volume, Filter less/more, Recover |
| 5 | Inheritance, Speller |

- Lectures are the Fall 2025 recordings. YouTube IDs come from the official pages: L1 `SlqjA04_dpk`, L2 `h5Gc1n8ZuU8`, L3 `6Svu_ae5ebk`, L4 `db0H0U13YsA`, L5 `PmAI76OGE_E`.
- Timestamps below come from the official `cdn.cs50.net/2025/fall/lectures/N/lang/en/lectureN.srt` files.
- **The Lecture 5 SRT is offset by +1:00:00.** Its first cue is at 01:00:44, while other lectures start at 00:00:44. I have corrected for this, but check it in the player.

**Book chapters checked against primary sources**
- **CS:APP 3e:** full table of contents from `csapp.cs.cmu.edu/3e/pieces/preface3e.pdf`.
- **OSTEP v1.10:** chapter list from the book's home page.
- **Modern C, C23 edition:** free HAL PDF (Oct 2024). The author notes that "there may be some notable differences in numbering" in the Manning print edition (Aug 2025, ISBN 9781633437777, 552 pp).
- **Effective C 2e:** 11 chapters (PRH page; ISBN 9781718504127; covers C23).
- **Beej's Guide to C v0.11.0:** dated September 26, 2026.
- **GNU Make 4.4.1:** `make.texi` from ftp.gnu.org.
- **Nand2Tetris:** projects 1–12.
- **K&R 2e:** §5.4, §6.6 and §8.7 confirmed via a sample-pages listing.
- **CLRS 4e:** ch. 2 "Getting Started" and ch. 3 "Characterizing Running Times", confirmed via search result.

### 0.2 Read or assumed, not run here
- Apple CLT ships GNU Make 3.81, Apple clang and lldb.
- Valgrind is not available on Apple Silicon. Use ASan plus `leaks --atExit` on macOS. LeakSanitizer is not used on macOS.
- `dtruss` needs SIP changes.
- `perf` on WSL is limited.
- V8 has used TimSort since v7.0 (2018).
- Chrome DevTools can debug wasm with DWARF information.
- Non-CS50 YouTube videos: none verified, because YouTube is unreachable from here.

---

## 1. Design rules

### Ordering logic
- **Early wins.** Learners build something real by week 2 (Pyramids/Change) and see live image output from their own C in M7.
- **Visual hooks before abstractions.** CSS hex colours open M2, `ArrayBuffer`/`DataView` explain bytes, the DOM tree explains trees.
- **Local toolchain arrives exactly when the browser stops being enough.** That is M6, right after pointers. The browser silently accepts NULL dereferences, writes to string literals and heap overflows, and it cannot run ASan (all verified). Setup friction is therefore zero for the first 12 weeks, and the switch is motivated by real bugs.
- **Interleaving.** Each module starts with a spaced retrieval quiz. Visualizers come back in later modules: the stepper appears in M4, M5, M6, M8, M9 and the capstone; the byte viewer in M2, M3, M5 and M7.

### Snippet tags
- **[browser]** runs in the in-browser wasm32 toolchain.
- **[native]** shows output stored by the build pipeline from native runs.
- **[both]** shows a diff panel when the outputs differ.

Settings for the in-browser compiler (all verified to work):
- Base flags: `-std=c17 -Wall -Wextra -pedantic -Wl,-z,stack-size=8388608`. The stack flag mimics the native 8 MiB stack.
- Exercise "guardrail mode" adds `-fsanitize=undefined -fsanitize-trap=undefined` and maps `RuntimeError: unreachable` to "undefined behaviour trapped".
- UB-demo snippets always show the [native] panel next to the browser output.

### Interaction codes (used in the lesson tables)
| Code | Interaction |
|---|---|
| **PR** | predict before running. The answer always comes from pipeline-run output |
| **CT** | write code that must pass automated tests |
| **FB** | fix a bug starting from a symptom report |
| **MD** | fill in a memory diagram |
| **PA** | Parsons problem (reorder given lines) |
| **CE** | interpret a real compiler, linker or sanitizer message |
| **SP** | stepper: predict the next state |
| **NP** | number-playground task |
| **TT** | trace table |

- **Pacing rule:** at most ~250 words, or one animation or video, before every interaction. The pipeline enforces this by counting words between interactive blocks.

### Hints and solutions
- Three hint tiers: **H1** concept nudge, **H2** where to look, **H3** pseudocode or partial code.
- The solution unlocks after (≥3 test runs with code changed in between, or ≥20 minutes active) **and** H3 has been viewed.
- After the solution, the learner must pass a **variant exercise** (same skill, different surface) before the skill counts as mastered.

### Checkpoints
- Gated: the next module stays locked until it is passed.
- 30–45 minutes, 8–12 items, pass mark **80%**.
- Every checkpoint includes one "transfer" item set in an unfamiliar context.
- A retake draws fresh variants from item pools generated from verified snippets.
- Failed items are scheduled into the next retrieval quiz.

### Retrieval quizzes
- 6–10 items, about 10 minutes, at the start of each module.
- Mix: about 40% from the previous module, 30% from two modules back, 30% from older modules (expanding spacing).

### Weekly rhythm
- About 3 lesson sessions of 40–60 minutes plus one 2-hour practice or project block.
- Typical module budget: lessons ≈ 40–45%, project ≈ 30–35%, variants/practice ≈ 15%, quiz + checkpoint ≈ 10%.

### Catalogs

**Visualizers**
- **V1 Number Playground:** bits, hex, unsigned/two's complement, IEEE-754 float/double, overflow wheel, comparison with JS Number.
- **V2 Byte Viewer:** live wasm linear memory, or native bytes captured by the pipeline; endianness; struct padding with an `offsetof` overlay; wasm32/x86-64 layout toggle.
- **V3 Stack/Heap Stepper:** precomputed traces with frames, locals and heap blocks; predict-next-state mode; heap mode can render the capstone's `mm_dump()` JSON.
- **V4 Pointer Diagrams:** auto-drawn from traces, plus drag-to-draw for MD items.
- **V5 Hash-Table Collision Visualizer:** choice of hash function, bucket count, load factor, chaining vs linear probing, histogram of chain lengths.
- **V6 Cache Simulator:** size, line size, associativity, address trace taken from a C loop, hit/miss heat map.
- **V7 Pipeline Explorer:** `.i`, `.s` (x86-64 and arm64 side by side), `nm`/`objdump` output, link map. All static, generated by the pipeline.
- **V8 Syscall Tracer:** wraps the WASI imports to log `fd_write` and friends (verified feasible); shows native `strace` output next to it.
- **V9 Algorithm Race:** sort/search bars with comparison and swap counters.
- **V10 Register Stepper:** assembly with register values from scripted gdb/lldb `stepi` traces, plus a toy 8-instruction machine.

**HyperFrames animations (30–90 s)**
| ID | Topic | Length |
|---|---|---|
| A1 | `hello.c` → running process: preprocess → compile → assemble → link → load | 75 s |
| A2 | two's-complement wheel | 45 s |
| A3 | anatomy of a float | 60 s |
| A4 | function call pushes and pops a frame | 50 s |
| A5 | merge sort split and merge | 60 s |
| A6 | `malloc`/`free` from the heap's point of view | 60 s |
| A7 | BMP anatomy: headers, BGR, bottom-up rows, 4-byte row padding | 60 s |
| A8 | hashing a word into a bucket, collisions | 50 s |
| A9 | fetch–decode–execute | 60 s |
| A10 | calling convention: arguments in registers, `call`/`ret` | 60 s |
| A11 | linker symbol resolution and relocation | 75 s |
| A12 | cache lines, sets, hit/miss, row vs column | 75 s |
| A13 | `fork`/`exec`/`wait` | 60 s |
| A14 | from `printf` to syscall to terminal | 60 s |
| A15 | virtual-to-physical page translation | 75 s |
| A16 | allocator free list: split and coalesce | 75 s |

**YouTube segments.** All are CS50x 2026 English lectures. Timestamps are SRT-derived, so check them in the player.
| ID | Lecture | Segment | Topic |
|---|---|---|---|
| Y1 | L1 | 02:19:40–02:29:40 | integer overflow, Boeing 787, floating-point imprecision, Y2K |
| Y2 | L2 | 01:35:00–01:52:00 | strings and the NUL terminator |
| Y3 | L3 | 01:45:50–01:58:00 | merge sort |
| Y4 | L4 | 01:27:40–01:30:35 | Binky claymation |
| Y5 | L4 | 01:39:40–01:49:50 | memory layout, swap, stack/heap overflow |
| Y6 | L2 | 00:40:50–00:58:50 | compiling by hand with clang, `-l` linking, the four steps |
| Y7 | L4 | 01:14:00–01:23:00 | valgrind |
| Y8 | L4 | 02:02:30–02:19:20 | file I/O, `fopen`, CSV, JPEG |
| Y9 | L5 | ≈00:34–00:55 (offset-corrected) | linked lists |
| Y10 | L5 | ≈01:38–02:00 (offset-corrected) | hashing, hash tables, tries |

M9–M12 use no YouTube by default. They rely on A9–A15, because I could not verify any non-CS50 video IDs.

**Success-criteria IDs**
| ID | A graduate can… |
|---|---|
| SC1 | explain source → process (preprocess, compile, link, load) |
| SC2 | draw the memory layout and say where any variable lives |
| SC3 | use pointers, arrays, strings, structs and dynamic memory |
| SC4 | find memory bugs with a debugger and ASan/Valgrind |
| SC5 | implement data structures from scratch |
| SC6 | reason about Big-O and use standard sorting/searching |
| SC7 | work with number representation, endianness and bitwise ops |
| SC8 | explain the CPU, registers, caches and access patterns |
| SC9 | read assembly generated from their own C |
| SC10 | use syscalls for files and processes and explain what the OS does |
| SC11 | build multi-file projects with Make, headers and the C ABI |

---

## 2. Modules

### M1: C in Your Browser, from JS to C · 10 h (2 wk) · [browser]
**Why it matters:** the learner writes real C on day one with zero setup. TS/JS habits map onto C syntax, and real compiler diagnostics teach that C's types are memory layouts, not labels.

**Week plan:** W1 lessons 1.1–1.3. W2 lessons 1.4–1.6, project, checkpoint.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 1.1 | Hello, compiled world (40) | `main`, `#include`, `printf`, exit status; compiling vs a JIT. Deleting `#include` gives a clang **error**, while gcc 13 only **warns** (both verified) | PR on escape sequences, CE | A1 (overview), V7 lite |
| 1.2 | Types are layouts (45) | `int`/`char`/`double`/`bool`, format specifiers, integer division (7/2, −7/2), implicit conversions | PR, CE (`-Wformat`), NP teaser | V1 |
| 1.3 | Control flow (40) | if/switch (fall-through), while/for/do; `=` vs `==` warning (verified) | PA, FB (off-by-one loop), PR | none |
| 1.4 | Functions and scope (45) | prototypes, pass-by-value, block scope, no closures | PR ("does the caller's variable change?"), CT `max3` | V3 frames-only teaser |
| 1.5 | Input without magic (40) | course helpers `read_int`/`read_line` with source visible ("you'll rebuild this in M5"); `scanf` pitfalls; stdin panel | CT hello-name, PR on bad input | none |
| 1.6 | Read the compiler like a linter (35) | `-Wall -Wextra -pedantic`, fix the first error first. Missing `printf` argument prints `score 0` in the browser but garbage natively | CE ×5 (verified texts), PR [both] | diagnostics explainer |

**Project P1, Pyramids & Change (≈3 h).**
- Covers mario-less, mario-more (double pyramid) and cash (greedy coins).
- The **test runner** (in browser, also downloadable for later) checks:
  - re-prompting on non-numeric and out-of-range input;
  - byte-exact stdout for heights 1–8;
  - coin counts for edge cases (0.01, 0.41, 4.20 entered in dollars or cents per spec);
  - clean compile with `-Werror` in the browser; the pipeline also compiles natively with gcc and clang.

**Checkpoint C1 (30 min).** 3 PR, 2 CE, 1 PA, 2 CT micro-functions, 1 FB transfer item.

**Retrieval quiz:** activates prior JS knowledge (`typeof`, `0.1+0.2`, the DevTools call stack, `===`).

**Resources:**
- Beej's Guide to C v0.11.0, ch. 2 "Hello, World!", ch. 3 "Variables and Statements", ch. 4 "Functions".
- K&R 2e ch. 1 "A Tutorial Introduction".

**Success criteria:** SC1 (I), SC3 (I).

| JS analogy | Lesson | Holds | Breaks down |
|---|---|---|---|
| `let x: number` ↔ `int x` | 1.2 | declared types, compile-time checking | TS types are erased; C types decide size and instructions; truncation is silent |
| `console.log` ↔ `printf` | 1.1, 1.6 | formatted output | the format string must match the argument types; a mismatch is undefined behaviour, not coercion |
| `Math.trunc(a/b)` ↔ `int/int` | 1.2 | truncation toward zero | in C it happens implicitly whenever both operands are ints |
| functions ↔ functions | 1.4 | parameters, return values | no closures, no first-class inner functions; arguments are always copied |

---

### M2: Bits, Bytes & Numbers · 10 h (2 wk) · [browser]
**Why it matters:** JS hides everything behind one IEEE double. C exposes widths, signedness, overflow and bytes, and every later topic (pointers, files, assembly) assumes this fluency. CSS colours and TypedArrays give strong hooks.

**Week plan:** W1 lessons 2.1–2.3. W2 lessons 2.4–2.6, project, checkpoint.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 2.1 | Binary and hex (40) | place value; hex as compact binary; `#RRGGBB` | NP, PR | V1 |
| 2.2 | Widths and `sizeof` (40) | `<stdint.h>`, `size_t`; wasm32 vs x86-64 size table (verified) | PR on both targets | V1, V2 |
| 2.3 | Unsigned and two's complement (45) | wraparound, signed overflow is undefined behaviour, casts; `twos.c` (verified) | PR, NP | A2, V1 |
| 2.4 | Bitwise operators and masks (45) | `& \| ^ ~ << >>`, flags, RGBA packing; shift by ≥ width is undefined behaviour | CT pack/unpack, PR | V1 |
| 2.5 | Floating point (45) | sign, exponent, mantissa; `0.30000000000000004`; `16777217.0f` → `16777216` (verified) | NP, PR | A3, V1, **Y1** |
| 2.6 | Characters and encodings (35) | ASCII, `char` as a small integer, UTF-8 (`strlen("é")` = 2, verified) vs JS UTF-16; first look at endianness (`04 03 02 01`) | PR, MD (bytes) | V2 |

**Project P2, Credit & Colors (≈3 h).**
- Luhn credit-card validator with AMEX/MASTERCARD/VISA/INVALID classification, using `int64_t`/`long long`. The tests include card numbers above 2³¹, so `long` fails in the browser with a visible `-Wconstant-conversion` warning (verified). That failure is the lesson.
- `hexcolor`: parse `#RGB`/`#RRGGBB`, print the components, blend two colours.
- **Test runner** checks: ≥20 card cases including 13/15/16-digit numbers and wrong prefixes; exact output; hex parsing edge cases (lowercase, missing `#` is rejected); clean compile.

**Checkpoint C2.** 4 NP/PR conversions, 2 PR on overflow/float, 1 MD byte-order item, 2 CT bit functions, 1 transfer item (decode a packed timestamp).

**Retrieval quiz:** M1.

**Resources:**
- CS:APP 3e §2.1 "Information Storage" through §2.4 "Floating Point".
- Beej v0.11.0 ch. 24 "Bitwise Operations".

**Success criteria:** SC7 (I→A), SC3 (D).

| JS analogy | Lesson | Holds | Breaks down |
|---|---|---|---|
| `x\|0`, `x>>>0` ↔ `int32_t`/`uint32_t` | 2.3–2.4 | `(2**31)\|0` = −2147483648 and `-1>>>0` = 4294967295 (verified) | signed overflow in C is undefined behaviour, not wraparound; C has many widths; shifts ≥ width are undefined |
| `Uint8Array`/`Int16Array` ↔ fixed-width arrays | 2.2 | element size and wraparound | no bounds checks in C |
| `DataView` ↔ explicit byte order | 2.6 | offsets and byte order | `DataView` defaults to **big-endian** (verified); TypedArrays and C on x86/ARM/wasm are little-endian |
| `0.1+0.2` ↔ `double` | 2.5 | identical IEEE results (verified) | C also has `float` (24-bit significand); `Math.fround` is JS's closest equivalent |
| `BigInt` ↔ nothing | 2.2 | n/a | C has no arbitrary-precision integers |

---

### M3: Arrays, Strings & the Command Line · 10 h (2 wk) · [browser]
**Why it matters:** this is the first module where C's "no safety net" model bites. Strings stop being values and become bytes ending in NUL, and the learner builds real CLI tools.

**Week plan:** W1 lessons 3.1–3.3. W2 lessons 3.4–3.6, project, checkpoint.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 3.1 | Arrays (40) | contiguous storage, no `.length`, no bounds checks; the `sizeof` trick; array decay and `-Wsizeof-array-argument` (verified) | PR [both] (4 vs 8 bytes), MD | V2 |
| 3.2 | Strings are `char` + NUL (45) | `"hello"` is 6 bytes (verified); `string.h`; `strlen` is O(n); prefer `snprintf` over `strcpy`/`strcat` | PR, MD | V2, **Y2** |
| 3.3 | Character arithmetic (35) | `ctype.h`, `'a'+k`, modulo rotation | CT `rotate()`, PR | V1 (ASCII) |
| 3.4 | 2D arrays and arrays of strings (35) | row-major layout (foreshadows M11) | MD | V2 |
| 3.5 | `argc`/`argv` and exit codes (40) | `strtol` validation vs `atoi`; non-zero exit status | CT with an args panel, FB (`argv[1]` is NULL) | none |
| 3.6 | Defensive strings (35) | buffer overflow concept, `fgets`, why `gets` was removed | FB (missing NUL), CE | V2 |

**Project P3, Text Lab (≈3.5 h).** Scrabble, Readability (Coleman–Liau with correct rounding), Caesar and Substitution.
- **Test runner** checks: stdin and argv cases; exit codes (1 on a bad key); case preservation; punctuation untouched; substitution keys with duplicates, wrong length or non-letters are rejected; readability grade boundaries ("Before Grade 1", "Grade 16+").
- Optional "Wordle" extension (named in the brief, not a 2026 CS50x problem).

**Checkpoint C3.** 3 PR (string `sizeof`/`strlen`, [both]), 1 MD, 2 CE, 2 CT, 1 FB transfer item.

**Retrieval quiz:** M2 (60%), M1 (40%).

**Resources:**
- Beej ch. 6 "Arrays", ch. 7 "Strings", ch. 18 "The Outside Environment".
- Effective C 2e ch. 7 "Characters and Strings".

**Success criteria:** SC3 (D), SC7 (D).

| JS analogy | Lesson | Holds | Breaks down |
|---|---|---|---|
| `Array` ↔ C array | 3.1 | indexed access | C arrays are fixed size, one element type, no `.length`; reading out of bounds returns garbage, not `undefined` |
| `string` ↔ `char[]` | 3.2 | sequence of characters | C strings are mutable bytes, not immutable UTF-16; their length is found by scanning for NUL |
| `process.argv` ↔ `argv` | 3.5 | arguments arrive as strings | `argv[0]` is the program itself; node's `argv[0..1]` are node and the script |
| template literals ↔ `snprintf` | 3.6 | formatting into a string | you must provide the buffer and its size |

---

### M4: Algorithms, Recursion & Big-O · 15 h (3 wk) · [browser]
**Why it matters:** this module gives the vocabulary of efficiency and the first real look at the call stack. Structs arrive the way they do in CS50 Week 3.

**Week plan:** W1 lessons 4.1–4.2. W2 lessons 4.3–4.5. W3 lessons 4.6–4.7, project, checkpoint.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 4.1 | Search and Big-O (45) | linear vs binary search; O, Ω, Θ | PR (comparison counts), TT | V9 |
| 4.2 | Simple sorts (50) | bubble, selection, insertion; invariants | PA, TT | V9 |
| 4.3 | Recursion and the call stack (50) | base case, frames. Stack-depth demo, all verified: in the browser, ~13k frames end in **`RangeError: Maximum call stack size exceeded`**; natively SIGSEGV after ~27k frames | SP, PR [both] | A4, V3 |
| 4.4 | Merge sort (50) | divide and conquer, n log n | CT `merge_sort`, PR | A5, V9, **Y3** |
| 4.5 | Structs, first contact (40) | `struct candidate`, arrays of structs; copy on assign or pass | PR (value-copy surprise) | V3 |
| 4.6 | Measuring growth (35) | `timespec_get` in the browser; ratio when n doubles | PR | V9 |
| 4.7 | Graphs lite (40, optional) | adjacency matrix, DFS cycle check (for Tideman) | TT | V9 graph mode |

**Project P4, Elections & Sorts (≈5 h).**
- **Which sort?** Identify three mystery sort programs (compiled to wasm) from timings on sorted, reversed and random inputs. Answers are auto-checked.
- **Plurality** and **Runoff**. **Tideman** is an optional challenge.
- **Test runner** links the learner's file against a hidden test `main`. It unit-tests `vote`, `tabulate`, `find_min`, `is_tie`, `eliminate` (and `lock_pairs` with cycle cases for Tideman), and runs end-to-end ballots.

**Checkpoint C4.** 2 TT, 2 PR on complexity, 1 SP stack-frame item, 1 PA, 2 CT, 1 transfer item (choose an algorithm from given constraints).

**Retrieval quiz:** M3, M2, M1.

**Resources:**
- CLRS 4e ch. 2 "Getting Started" and ch. 3 "Characterizing Running Times".
- K&R 2e §4.10 "Recursion".

**Success criteria:** SC6 (A), SC2 (I), SC3 (D).

| JS analogy | Lesson | Holds | Breaks down |
|---|---|---|---|
| `arr.sort((a,b)=>a-b)` ↔ `qsort` comparator | 4.2, 4.4 | same negative/zero/positive contract | JS's default sort compares strings; `qsort` needs element size and `void*` |
| "Maximum call stack size exceeded" ↔ stack overflow | 4.3 | the stack is finite; each call costs a frame (verified, same error text in the browser) | natively it is a signal (SIGSEGV), not a catchable exception |
| objects by reference ↔ structs by value | 4.5 | grouped fields | assigning or passing a struct copies it; mutating the copy does not touch the original |

---

### M5: Pointers & Dynamic Memory · 15 h (3 wk) · [browser, with native panels for undefined-behaviour demos]
**Why it matters:** this is the core skill gap for this audience. The in-browser runtime makes the abstraction concrete: in wasm32, memory really is one `ArrayBuffer`, and a pointer really is a byte offset into it.

**Week plan:** W1 lessons 5.1–5.3. W2 lessons 5.4–5.6. W3 lessons 5.7–5.8, project, checkpoint.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 5.1 | Addresses (40) | `&`, `%p`; memory as one big `Uint8Array` (the live `WebAssembly.Memory`) | PR, MD | V2 (live memory) |
| 5.2 | Dereferencing (45) | `*`, typed pointers, NULL. A NULL read prints 0 in the browser but SIGSEGVs natively (verified); guardrail mode traps it | PR [both], MD | V4, **Y4** |
| 5.3 | swap via pointers (40) | frames plus pointers | SP | V3, V4 |
| 5.4 | Pointer arithmetic and arrays (45) | `a[i] ≡ *(a+i)`, decay, one past the end | PR, PA | V2, V4 |
| 5.5 | Code, static, stack, heap (45) | where every kind of variable lives | MD ("place each variable") | A6, V3, **Y5** |
| 5.6 | `malloc`/`calloc`/`realloc`/`free` (50) | ownership, failure checks, dangling pointers, double free, leaks. Use-after-free "works" on both targets (verified): undefined behaviour is not a crash | FB, SP | V3 heap |
| 5.7 | Strings revisited, `char **` (45) | literals are read-only (browser prints `Jello`, native SIGSEGV, verified); copying strings; arrays of pointers; `argv` | PR [both], MD | V4 |
| 5.8 | `const` and ownership conventions (30) | `const T*` vs `T* const`; documenting who frees | PA, CE | none |

**Project P5, Build Your Own String Toolkit (≈4.5 h).**
- Functions: `str_len`, `str_dup`, `str_concat_alloc`, `split` (returns `char**` and a count), `join`, `free_strings`.
- `read_line(FILE*)` uses `realloc` doubling. It **replaces the course helper used since M1**.
- **Test runner** (browser) unit-tests edge cases: empty strings, consecutive delimiters, 10 KB lines, and NULL handling per spec.
- In M6 the learner re-runs these tests locally under ASan and Valgrind (designed "aha" moment).

**Checkpoint C5.** 3 MD (stack/heap/static placement and arrows), 2 SP, 2 PR [both], 1 FB, 2 CT.

**Retrieval quiz:** M4 (recursion frames), M3 (NUL), M2 (hex addresses).

**Resources:**
- K&R 2e ch. 5 "Pointers and Arrays", §5.1–5.6.
- Beej ch. 5 "Pointers—Cower In Fear!", ch. 11 "Pointers II: Arithmetic", ch. 12 "Manual Memory Allocation".

**Success criteria:** SC2 (A), SC3 (A).

| JS analogy | Lesson | Holds | Breaks down |
|---|---|---|---|
| object references ↔ pointers | 5.2–5.3 | aliasing; mutation through a shared reference | C pointers have arithmetic, can dangle, and null dereference is undefined behaviour, not a `TypeError` |
| `ArrayBuffer`/`WebAssembly.Memory` ↔ address space | 5.1, 5.4 | **exactly true in wasm32**: pointer = byte offset | natively: 64-bit virtual memory, ASLR, protected pages; this is why NULL crashes natively and not in wasm |
| garbage collection ↔ `free` | 5.6 | memory has lifetimes | you decide the lifetime. A JS leak is still-reachable data; a C leak is unreachable but never freed |
| `arr.push` growth ↔ `realloc` doubling | P5 | amortized O(1) | `realloc` may move the block, so old pointers become invalid |
| spread/`structuredClone` ↔ struct copy | 5.7 | shallow vs deep copy | a copied struct shares whatever its pointers point to |

---

### M6: Going Native: Toolchain, Debugger & Sanitizers · 10 h (2 wk) · [native]
**Why it matters, and why now:** P5 bugs are invisible in the browser. A heap overflow prints `0` and exits 0 there, ASan cannot link there, and locally gcc ASan pinpoints `overflow.c:6` (all verified). Setup happens when the learner already wants it.

**Week plan:** W1 lessons 6.1–6.3. W2 lessons 6.4–6.6, project, checkpoint.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 6.1 | Install (60) | macOS: `xcode-select --install`. Windows: `wsl --install`, then Ubuntu, then `sudo apt install build-essential gdb valgrind`. VS Code with clangd/C++ and CodeLLDB. A `doctor.sh` checks the compiler, `-std=c17`, an ASan smoke test and the debugger | CT (doctor passes), troubleshooting cards | none |
| 6.2 | Compiling by hand (40) | `-o -g -O0/-O2 -Werror`; re-run `sizes.c` and predict 8-byte `long`/pointers | PR [both] | **Y6**, V7 |
| 6.3 | Debugger basics (60) | lldb/gdb side by side: `break`, `run`, `next`, `step`, `finish`, `bt`, `print`/`frame variable`, `watch`, `x` | FB (segfault → `bt`), SP while stepping | V3 bridge |
| 6.4 | Sanitizers (50) | ASan, UBSan; LeakSanitizer on Linux; `leaks --atExit` on macOS (docs). Read an ASan report; re-run P5 | CE (ASan/UBSan reports) | none |
| 6.5 | Valgrind on Linux/WSL (30) | `--leak-check=full`; "definitely lost … `dup (leak.c:3)`" (verified) | CE | **Y7** |
| 6.6 | Two files and a Makefile (45) | `.h`/`.c`, include guards, a minimal Makefile compatible with make 3.81, `make test`; "undefined reference" error | PA (Makefile), CE (verified linker texts) | V7 |

**Project P6, Bug Hunt (≈3 h).**
- Six programs with symptom reports: "garbage sometimes", "crashes on long names", "memory grows", "wrong after second call", and others.
- The learner reproduces each bug, locates it with the debugger or a sanitizer, fixes it, and writes `diagnosis.md`.
- **Test runner** (`make test`):
  - builds with `-g -fsanitize=address,undefined`;
  - runs scripted cases and requires **zero sanitizer reports**;
  - runs Valgrind clean (Linux/WSL) or `leaks` clean (macOS);
  - pattern-checks that `diagnosis.md` names the right file and line;
  - re-runs P5's tests under ASan.

**Checkpoint C6.** 3 CE (ASan, UBSan, Valgrind excerpts), 2 debugger-command PA, 1 FB (local, auto-checked), 2 PR, 1 MD.

**Retrieval quiz:** M5, M4 (stack), M2.

**Resources:**
- Effective C 2e ch. 11 "Debugging, Testing, and Analysis".
- GNU Make manual 4.4.1, ch. 2 "An Introduction to Makefiles".

**Success criteria:** SC4 (I→A), SC11 (I), SC1 (D).

| JS analogy | Lesson | Holds | Breaks down |
|---|---|---|---|
| DevTools Sources ↔ lldb/gdb | 6.3 | breakpoints, step into/over/out, call stack, watches | no hot reload; optimized builds show `<optimized out>` |
| source maps ↔ `-g` DWARF | 6.2 | map machine code back to source | you must rebuild with `-g` |
| heap snapshot ↔ Valgrind/LSan | 6.4–6.5 | find leaks | the opposite definition of a leak (reachable in JS, unreachable in C) |
| npm scripts ↔ Makefile targets | 6.6 | named tasks | Make rebuilds based on file timestamps and dependencies |
| `import` ↔ `#include` | 6.6 | reuse code from another file | `#include` pastes text: no module scope, needs include guards, declaration ≠ definition |

---

### M7: Structs, Files & Binary Formats · 15 h (3 wk) · [lesson snippets in browser, projects native; optional in-browser image preview]
**Why it matters:** real data lives in files with byte-level layouts. Image filters give this audience instant visual feedback.

**Week plan:** W1 lessons 7.1–7.3. W2 lessons 7.4–7.5 and Volume. W3 lesson 7.6, Filter, Recover, checkpoint.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 7.1 | Structs in depth (45) | `typedef`, `->`, designated initializers, compound literals | PR, CT | V4 |
| 7.2 | Alignment and padding (45) | `offsetof`; reordering 12 → 8 bytes; `Node` is 8 vs 16 bytes (verified) | PR [both], MD (padding bytes) | V2 toggle |
| 7.3 | Text streams (40) | `FILE*`, modes, `fgets`/`fprintf`, `perror`/`errno`, CSV | CT, FB (unchecked `fopen`) | **Y8** |
| 7.4 | Binary I/O (45) | `fread`/`fwrite`, headers as structs, little-endian WAV/BMP | PR, MD | A7, V2 |
| 7.5 | Images as pixel arrays (45) | BGR, bottom-up rows, row padding; `RGBTRIPLE (*img)[w]`; blur/edge kernels; output BMP previewed in the browser | CT | V2, image preview |
| 7.6 | Signatures and recovery (35) | JPEG magic bytes, 512-byte blocks; write a mini `xxd` | CT | V2 |

**Project P7, Media Lab (≈6 h, native with starter code and test runner).** Volume, Filter (less: grayscale/sepia/reflect/blur; more: grayscale/reflect/blur/edges), Recover.
- **Test runner** checks:
  - byte-exact output checksums against the reference;
  - headers preserved;
  - bad arguments rejected with the right exit codes;
  - Recover's count and checksums of recovered JPEGs;
  - ASan/UBSan clean, plus Valgrind on Linux.

**Checkpoint C7.** 2 PR on layout ([both]), 1 MD (BMP row with padding), 2 CE, 2 CT, 1 FB, 1 transfer item (parse an unseen header spec).

**Retrieval quiz:** M6 (debugger), M5 (`malloc`), M3 (strings), M2 (endianness).

**Resources:**
- Beej ch. 9 "File Input/Output" and ch. 20 "structs II: More Fun with structs".
- Effective C 2e ch. 8 "Input/Output".

**Success criteria:** SC3 (A), SC7 (A), SC4 (D), SC10 (I: `FILE*` is a library over syscalls).

| JS analogy | Lesson | Holds | Breaks down |
|---|---|---|---|
| object ↔ struct | 7.1 | named fields | fixed layout, no dynamic keys, padding |
| `DataView.getUint16(off, true)` ↔ `offsetof` and reading bytes | 7.4 | offsets and endianness | dumping a struct with `fwrite` is not portable (padding, endianness, pointers) |
| Canvas `ImageData` ↔ BMP pixel array | 7.5 | row-major pixels, per-channel bytes | `ImageData` is RGBA, top-down, unpadded and clamped; BMP is BGR, bottom-up, padded to 4-byte rows |
| `JSON.stringify` ↔ `fwrite` | 7.4 | serialization | raw memory is not a format |

---

### M8: Data Structures from Scratch · 20 h (4 wk) · [lessons in browser, projects native]
**Why it matters:** CS50 Week 5 parity. The learner finally implements the Map, Set and tree structures they have used for years.

**Week plan:** W1 lessons 8.1–8.2. W2 lessons 8.3–8.4 and Inheritance. W3 lessons 8.5–8.7. W4 Speller and checkpoint.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 8.1 | ADTs and dynamic arrays (40) | header as contract; vector with doubling | CT | V3 |
| 8.2 | Linked lists (60) | insert, delete, search, free | MD, SP, FB (list lost by insert order) | V4, V3, **Y9** |
| 8.3 | Stacks and queues (40) | array and list versions; circular buffer | CT, PR | V4 |
| 8.4 | Binary search trees (50) | recursive insert, search, traverse; post-order free; degenerate case | SP, PA | V4, V3 |
| 8.5 | Hash tables (60) | djb2/FNV-1a, chaining, load factor, resizing | NP-style tuning, CT, PR | A8, **V5**, **Y10** |
| 8.6 | Tries (40) | 27-way nodes; memory vs speed | MD | V4 |
| 8.7 | Choosing and measuring (35) | time/space trade-offs; benchmark harness | PR ("which is faster?", answers from pipeline runs) | V5, V9 |

**Project P8a, Inheritance (≈2 h).** Recursive allocation of a family tree with blood-type alleles; free the whole tree.
- **Test runner** checks structure invariants over 1,000 seeded runs and requires ASan/Valgrind to report zero leaks.

**Project P8b, Speller (≈6 h).** `load`/`check`/`size`/`unload` with a hash table, multi-file with a Makefile.
- **Test runner** checks:
  - misspellings match the reference for 10 texts and 2 dictionaries;
  - case-insensitivity and apostrophes;
  - memory clean;
  - timing report (`load`/`check`/`size`/`unload`) feeds an optional leaderboard.

**Checkpoint C8.** 2 MD (list and BST operations), 1 SP, 1 hash-collision prediction (V5), 2 CT (implement `remove` for a list, a BST height function), 1 complexity PR, 1 FB.

**Retrieval quiz:** M7 (`->`, structs), M5 (`free`), M4 (Big-O, recursion), M6 (ASan reading).

**Resources:**
- K&R 2e §6.5 "Self-referential Structures" and §6.6 "Table Lookup".

**Success criteria:** SC5 (A), SC6 (D), SC4 (A), SC3 (A), SC11 (D).

| JS analogy | Lesson | Holds | Breaks down |
|---|---|---|---|
| `Map`/`Set` ↔ hash table | 8.5 | average O(1) | in C you choose the hash, handle collisions, resize and free; no insertion-order guarantee |
| DOM tree ↔ tree nodes | 8.4 | recursive traversal, which learners have done on the DOM | the learner owns every node's memory |
| React Fiber `child`/`sibling`/`return` ↔ linked nodes | 8.2 | pointer-linked structure (verified in react-reconciler 0.31.0) | no GC: unlinking without freeing leaks |
| `arr.shift()` cost ↔ queue design | 8.3 | O(n) shifting motivates a circular buffer | n/a |

---

### M9: Inside the CPU: Instructions, Registers & Assembly · 15 h (3 wk) · [native, plus static asm views in the browser]
**Why it matters:** the learner sees what their C actually becomes. Mac learners mostly see arm64, so every listing comes in both x86-64 and arm64 (pipeline-generated, verified).

**Week plan:** W1 lessons 9.1–9.3. W2 lessons 9.4–9.6. W3 lessons 9.7–9.8, project, checkpoint.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 9.1 | Machine model (45) | CPU, registers, memory; fetch–decode–execute | SP on a toy 8-instruction machine | A9, V10 |
| 9.2 | From C to assembly (45) | `-S -O0/-O1`; matching lines | PR ("which C line produced this?") | V7 (x86-64 and arm64) |
| 9.3 | Moves and arithmetic (45) | `mov`/`ldr`/`str`, `add`, `imul`, `lea`; sign extension (`movsx`/`ldrsw`, verified in `sum`) | PR | V7 |
| 9.4 | Control flow (45) | `cmp`/`test` with `jle`/`b.lt`; loops | PA (reorder asm into a loop), PR | V7, V10 |
| 9.5 | Procedures and the stack (50) | System V AMD64 (`rdi, rsi, rdx, rcx, r8, r9` → `rax`), AAPCS64 (`x0–x7` → `x0`); `call`/`ret`; saved registers; frame pointer | SP with register traces | A10, V10, V3 |
| 9.6 | Arrays, structs, pointers in asm (40) | scaled indexing `[rdi+rsi*4]`; struct offsets = `offsetof` | PR, MD | V7 |
| 9.7 | Reading -O2 output (35) | constant folding, inlining, loop rewriting; optimizations that rely on undefined behaviour | PR ("what disappears?") | V7 |
| 9.8 | Instruction-level debugging (40) | `disassemble`, `stepi`, `info registers`/`register read`, `x/16xb` | FB | V10 |

**Project P9, Asm Detective (≈4 h).**
- **(a)** Six bomb-lab-style "phases" in the browser. Each is a pipeline-generated listing of a mystery function, in x86-64 or arm64 as the learner chooses. The learner deduces the input that makes it return 1.
- **(b)** "Reverse it": write C equivalent to a given listing. Tests run hidden vectors against the learner's function.
- **(c)** Locally, step through their own build with `stepi` and submit the register values at a breakpoint. The runner parses a gdb/lldb batch log.

**Checkpoint C9.** 3 asm→C PR, 1 calling-convention MD (which registers hold which arguments), 1 PA, 1 SP, 2 CT-style "predict the return value".

**Retrieval quiz:** M8, M5 (frames), M2 (two's complement, hex), M7 (`offsetof`).

**Resources:**
- CS:APP 3e ch. 3, §3.1–3.7 ("A Historical Perspective" through "Procedures"), with §3.8–3.9 optional.
- *The Elements of Computing Systems* 2e / Nand2Tetris, Project 4 "Machine Language" and Project 5 "Computer Architecture" (optional deep path).

**Success criteria:** SC8 (I→A), SC9 (A), SC2 (A: frames in asm).

| JS analogy | Lesson | Holds | Breaks down |
|---|---|---|---|
| V8 JIT ↔ ahead-of-time compiler | 9.2 | both end as machine code | a JIT speculates and deoptimizes; C is compiled once for one target |
| wasm in DevTools ↔ x86/arm asm | 9.2 | both are "assembly" for the same C | wasm is a **stack** machine; CPUs are **register** machines |
| DevTools call stack ↔ real frames | 9.5 | the same call chain | the real frame is bytes in memory: return address, saved registers |

---

### M10: Building Real Programs: Linking, Loading, Libraries & the C ABI · 10 h (2 wk) · [native]
**Why it matters:** this demystifies "undefined reference" errors and shows the source → process path end to end. C is the interop language every runtime, including JS through wasm and N-API, speaks.

**Week plan:** W1 lessons 10.1–10.3. W2 lessons 10.4–10.6, project, checkpoint.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 10.1 | The four stages, for real (45) | `-E`, `-S`, `-c`, link; `nm`, `objdump -d`/`otool -tV` | CE ("which stage failed?" ×6) | A1 (full version), V7 |
| 10.2 | Symbols and linkage (45) | `extern`, `static`, declaration vs definition, one-definition rule; `multiple definition`/`undefined reference` (verified texts) | CE, FB | A11 |
| 10.3 | Libraries (40) | `ar` → `.a`; `-fPIC -shared` → `.so`/`.dylib`; `-L/-l`; `ldd`/`otool -L`; `dlopen` briefly | CT | V7 |
| 10.4 | Loading (40) | ELF/Mach-O segments, entry point → `main`, dynamic loader, ASLR (watch `%p` change between runs; this is why the pipeline normalizes addresses) | PR [native] | A1, V2 |
| 10.5 | Make, properly (45) | pattern rules, `$@ $< $^`, `-MMD -MP`, phony targets, debug/release, `-j`; 3.81-safe | PA, CT | none |
| 10.6 | The C ABI (40) | calling convention (from M9), struct layout as ABI, symbol naming (`_sum` on macOS, verified); FFI: wasm exports to JS, N-API, ctypes | CT (call your C from JS in the browser) | V7 |

**Project P10, Libify (≈3 h).** Restructure Speller (or Filter) into `libspell.a`, `libspell.so`/`.dylib`, a CLI and a test binary.
- The Makefile has auto header dependencies and `test`/`release`/`clean` targets.
- One function is exported and called from JS through the wasm build.
- **Test runner** checks:
  - touching one header rebuilds only its dependents (parses `make -n`);
  - `nm` shows only API symbols exported, all helpers `static`;
  - the shared library loads;
  - the tests pass.

**Checkpoint C10.** 3 CE (link/compile/preprocess errors), 1 Makefile PA, 1 MD (segments of a process), 2 PR, 1 transfer item ("why does this library crash when the struct changes?").

**Retrieval quiz:** M9 (calling convention), M6 (Make basics), M1 (pipeline overview), M7 (layout).

**Resources:**
- CS:APP 3e ch. 7 "Linking", §7.1–7.12.
- GNU Make 4.4.1 ch. 4 "Writing Rules", including §4.14 "Generating Prerequisites Automatically".

**Success criteria:** SC1 (A), SC11 (A), SC9 (R).

| JS analogy | Lesson | Holds | Breaks down |
|---|---|---|---|
| bundler (Vite/esbuild) ↔ compiler + linker | 10.1–10.2 | module graph → one artifact; tree shaking ≈ dead-code stripping | no runtime module registry; C symbols are global unless declared `static` |
| `node_modules` ↔ libraries + headers | 10.3 | reusable code | no default package manager; the ABI must match |
| `import()` ↔ `dlopen` | 10.3 | load code at runtime | n/a |
| package.json `exports` ↔ symbol visibility | 10.6 | a public surface | n/a |

---

### M11: Memory Hierarchy & Performance · 10 h (2 wk) · [browser cache simulator and native benchmarks]
**Why it matters:** this explains why the same Big-O can run 17× slower (verified). Front-end engineers already think in latency and caching from network waterfalls.

**Week plan:** W1 lessons 11.1–11.3. W2 lessons 11.4–11.6, project, checkpoint.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 11.1 | Latency ladder (35) | registers → L1/L2/L3 → DRAM → SSD | PR | DevTools waterfall analogy |
| 11.2 | Caches (50) | lines, sets, direct-mapped vs set-associative, hits and misses | SP (next access hit or miss) | A12, **V6** |
| 11.3 | Locality in loops (45) | row vs column: 4.3×/17.2× native, 7.1× wasm, 4.3× JS (verified) | PR (predict the ratio), run [both] | V6 |
| 11.4 | Data layout (40) | array-of-structs vs struct-of-arrays; pointer chasing vs arrays | PR, CT | V6, V2 |
| 11.5 | Honest benchmarking (40) | warm-up, median, `-O2`, sinks; `perf stat` (Linux), Instruments (macOS) | FB (a flawed benchmark) | none |
| 11.6 | Letting the compiler help (35) | `-O` levels, inlining, vectorization glimpse, `restrict`, branch prediction | PR | V7 |

**Project P11, Make It Fast (≈3 h).** Optimize the P7 blur and a matrix transpose (blocking).
- **Test runner** checks: correctness, and speedup **relative to a baseline measured on the learner's own machine** (≥3× transpose, ≥2× blur).
- A short report compares V6 predictions with measurements.

**Checkpoint C11.** 3 V6 hit/miss predictions, 2 PR on performance ratios (answers come from the pipeline's measured *ordering*, not absolute numbers), 1 FB benchmark item, 1 asm-loop read.

**Retrieval quiz:** M10, M9 (asm loops), M3 (row-major), M8 (lists vs arrays).

**Resources:**
- CS:APP 3e §6.2 "Locality", §6.4 "Cache Memories", §6.5 "Writing Cache-Friendly Code", §6.6 "Putting It Together: The Impact of Caches on Program Performance".
- CS:APP ch. 5 §5.1–5.6 (optional).

**Success criteria:** SC8 (A).

| JS analogy | Lesson | Holds | Breaks down |
|---|---|---|---|
| HTTP/CDN/memory cache ↔ CPU caches | 11.1–11.2 | locality, hit rate | hardware-managed, 64 B granularity, no invalidation API, conflict misses |
| layout thrashing ↔ cache thrashing | 11.3 | access pattern is the bug | n/a |
| `Int32Array` traversal ↔ C traversal | 11.3 | the same 4.3× effect in plain JS (verified) | n/a |

---

### M12: The Operating System: Processes, System Calls & Virtual Memory · 15 h (3 wk) · [native POSIX; WSL on Windows]
**Why it matters:** this explains what the kernel does for every program. `<sys/wait.h>` does not exist in the browser toolchain (verified), so this module must be native. In the browser, JS literally plays the kernel through WASI, which makes the syscall tracer a strong bridge.

**Week plan:** W1 lessons 12.1–12.3. W2 lessons 12.4–12.6. W3 lessons 12.7–12.8, project, checkpoint.

| # | Lesson (min) | Content | Interactions | Visual |
|---|---|---|---|---|
| 12.1 | The syscall boundary (40) | user vs kernel mode, traps; WASI trace vs `strace` (verified; macOS `dtruss` per docs) | PR ("how many `write` calls?") | **V8**, A14 |
| 12.2 | File descriptors (45) | `open`/`read`/`write`/`close`, fds 0/1/2, stdio buffering; stdout and stderr ordering under redirection (verified) | CT (`cp` clone), PR [both] | V8 |
| 12.3 | `fork`/`exec`/`wait` (50) | copy-on-write; zombies and orphans | PR (output order), PA | A13, V3 |
| 12.4 | Pipes and redirection (45) | `dup2`, `pipe`; how `a \| b > f` works | CT | A13 |
| 12.5 | Signals and exit status (30) | a segfault *is* SIGSEGV; exit codes 128+n (139 verified) | PR | none |
| 12.6 | Virtual memory (50) | pages, page tables, TLB, `mmap`; same address in parent and child with different values (verified) | PR, MD | A15, V2 |
| 12.7 | Files and directories (35) | inodes, `stat`, permissions; mini `ls -l` | CT | none |
| 12.8 | Threads glimpse (30, optional) | pthreads, a data race; points to further study | PR | none |

**Project P12, msh, a mini shell (≈5 h).** Prompt loop, argument parsing, `fork`/`execvp`/`waitpid`, builtins `cd`/`exit`/`pwd`, `<` `>` `>>`, one `|`, `$?`.
- **Test runner** drives `msh` with scripted stdin and checks:
  - stdout, created files and exit codes;
  - no zombies (`ps`-based check);
  - no leaked file descriptors (`/proc/self/fd` on Linux, `lsof` on macOS);
  - ASan clean.

**Checkpoint C12.** 2 fork-output PR, 1 MD (fd table after `dup2`), 1 virtual-memory PR, 2 CT, 1 CE (`perror`/`errno`), 1 transfer item ("why does output appear twice after `fork`?", the buffering trap).

**Retrieval quiz:** M11, M10 (loader), M7 (`FILE*`), M5 (layout), M6.

**Resources:**
- OSTEP v1.10: ch. 4 "Processes", ch. 5 "Process API", ch. 13 "Address Spaces", ch. 39 "Files and Directories".
- CS:APP 3e ch. 10 "System-Level I/O" (with §8.4 "Process Control" optional).

**Success criteria:** SC10 (A), SC2 (A, virtual-memory lens), SC1 (D: load/exec), SC11 (D).

| JS analogy | Lesson | Holds | Breaks down |
|---|---|---|---|
| Web Worker ↔ process | 12.3 | isolated memory; message passing ≈ pipes | `fork` clones the whole process, memory and fds included; a Worker starts fresh |
| browser sandbox/permissions ↔ kernel | 12.1 | a privileged layer mediates I/O | n/a |
| WASI in our runtime ↔ syscalls | 12.1 | literally a syscall interface (`fd_write`) | n/a |
| site-isolated tabs ↔ address spaces | 12.6 | the same pointer value in two processes ≠ the same memory (verified) | n/a |

---

## 3. Capstone: Build `malloc` · 20 h (4 wk) · [native]
**Track A (default).** Implement `mm_malloc`, `mm_free`, `mm_realloc` and `mm_calloc` over an `mmap`'d arena (POSIX, works on macOS and Linux/WSL).

| Week | Milestone |
|---|---|
| 1 | implicit free list with first fit, plus `mm_check()` heap checker |
| 2 | boundary-tag coalescing and splitting |
| 3 | explicit or segregated free lists, `realloc` in place |
| 4 | benchmarking, integration, write-up |

**Visual:** A16, plus the V3 heap mode rendering the learner's `mm_dump()` JSON.

**Test runner** (trace-driven heap driver, 10 traces including speller-derived, realloc-heavy, random-size and tree-shaped):
- **Correctness:** 16-byte alignment, no overlap between live blocks, payload integrity checked against random patterns, `realloc` preserves `min(old,new)` bytes, `calloc` zeroes memory, `mm_check()` passes after every operation in debug mode, UBSan clean. ASan is not used because it conflicts with a custom arena.
- **Utilization** (peak live payload ÷ heap size): average ≥70%.
- **Throughput:** ≥0.5× the system `malloc`, measured in the same run. An implicit list typically fails this threshold, which pushes learners to segregated lists.
- **Integration:** Speller (P8b) and `msh` (P12) are rebuilt with `-include mm_shim.h` (macro redirect). Their output must be identical to the libc builds.

**Track B, Speller Pro.** Three dictionary backends: chained hash with resizing, open addressing, and a compact trie. Plus a benchmark harness (median of N runs, `-O2`), byte-accurate memory accounting through a counting wrapper, and cache-reasoned selection with V6 evidence.
- Must beat the course baseline check time by ≥2×, be ASan/Valgrind clean, and include a report.

**Final "Graduation Check" (60–90 min, gated certificate).** Cumulative items from every success criterion: draw a program's memory layout, diagnose errors by pipeline stage, read an asm listing, predict a fork program's output, interpret an ASan report, choose a data structure from constraints.

**Retrieval quiz:** M12 (`mmap`), M11, M7 (alignment), M5, M8.

**Resources:**
- CS:APP 3e §9.9 "Dynamic Memory Allocation" (§9.9.1–9.9.14: implicit lists, boundary tags, "Putting It Together: Implementing a Simple Allocator", explicit and segregated free lists).
- OSTEP v1.10 ch. 17 "Free Space Management".

**Success criteria:** SC2, SC3, SC4, SC5, SC8, SC10, SC11 (all D/A).

---

## 4. Success criteria → module coverage
I = introduced · D = developed · **A** = assessed (project or checkpoint) · R = retrieval only

| | M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8 | M9 | M10 | M11 | M12 | Cap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SC1 source→process | I | | | | | D | | | D | **A** | | D | R |
| SC2 memory layout | | | | I | **A** | D | | | **A** | D | | **A** | D |
| SC3 pointers/arrays/strings/structs/heap | I | D | D | D | **A** | D | **A** | **A** | | | | | **A** |
| SC4 debugger + ASan/Valgrind | | | | | I | **A** | D | **A** | D | | | D | D |
| SC5 lists/stacks/queues/hash/BST/trie | | | | I | D | | | **A** | | | | | D |
| SC6 Big-O, sort/search | | | | **A** | | | | D | | | D | | R |
| SC7 binary/hex/2's-compl/float/endian/bitwise | | **A** | D | | D | | **A** | | D | | R | | D |
| SC8 CPU/registers/caches/access patterns | | | I | | | | | | **A** | | **A** | | D |
| SC9 read asm from own C | | | | | | | | | **A** | D | D | R | |
| SC10 syscalls, files/processes, OS | | | | | | | I | | | | | **A** | D |
| SC11 multi-file, Make, headers, C ABI | | | | | | I | D | D | D | **A** | | D | **A** |

---

## 5. CS50x 2026 problem-set parity (list fetched from cs50.harvard.edu/x/2026)
Problem specs must be written in our own words. CS50 materials are CC BY-NC-SA, so the course may embed their videos but not copy their specs.

| CS50x pset (week) | Our equivalent | Where | Difference |
|---|---|---|---|
| Hello, World (1) | `hello` | M1 L1.1 | adds missing-header diagnostics, clang vs gcc |
| Hello, It's Me (1) | `hello-name` (stdin) | M1 L1.5 | no `cs50.h`; course helper, rebuilt by the learner in P5 |
| Mario less / more (1) | Pyramids (left, right, double) | P1 | both variants required |
| Cash (1) | Change | P1 | |
| Credit (1) | Credit (Luhn) | P2 | 64-bit integers; the wasm32 `long` trap is the lesson |
| Scrabble (2) | Scrabble | P3 | |
| Readability (2) | Readability | P3 | |
| Caesar / Substitution (2) | Ciphers (both) | P3 | both required |
| Wordle (in the brief; not in the 2026 list) | optional Wordle extension | P3 | optional |
| Sort (3) | Which Sort? (wasm mystery binaries) + own merge sort | P4 | adds implementation |
| Plurality (3) | Plurality | P4 | |
| Runoff / Tideman (3) | Runoff required, Tideman challenge | P4 | |
| Volume (4) | Volume | P7 | |
| Filter less / more (4) | Filter basic / edges | P7 | in-browser image preview |
| Recover (4) | Recover | P7 | plus a mini `xxd` |
| Inheritance (5) | Inheritance | P8a | leak-free requirement enforced |
| Speller (5) | Speller | P8b | extended in P10 (Libify) and Capstone Track B |
| Beyond CS50 | string toolkit, Bug Hunt, Asm Detective, Libify, Make It Fast, msh, malloc | P5, P6, P9–P12, Capstone | |

---

## 6. Further study (outside scope; exact pointers)
- **Concurrency:** OSTEP ch. 26 "Concurrency and Threads" through ch. 32 "Concurrency Bugs"; CS:APP ch. 12 "Concurrent Programming"; Modern C (C23 ed.) ch. 20 "Threads".
- **Networking:** CS:APP ch. 11 "Network Programming", ending at §11.6 "The Tiny Web Server".
- **Signals and nonlocal jumps:** CS:APP §8.5 "Signals" and §8.6 "Nonlocal Jumps".
- **Virtual memory internals:** OSTEP ch. 18–23 (Paging, TLBs, Advanced Page Tables, Swapping, Complete VM Systems); CS:APP §9.6–9.8.
- **File system implementation:** OSTEP ch. 40 "File System Implementation", ch. 41 "Fast File System (FFS)", ch. 42 "FSCK and Journaling".
- **Garbage collection:** CS:APP §9.10 "Garbage Collection".
- **Processor design and pipelining:** CS:APP ch. 4 "Processor Architecture" (Y86-64); Nand2Tetris Projects 1–5.
- **Building a VM and compiler:** Nand2Tetris Projects 7–11.
- **Deep optimization:** CS:APP §5.7–5.14.
- **Memory-safety exploitation:** CS:APP §3.10.3 "Out-of-Bounds Memory References and Buffer Overflow" and §3.10.4 "Thwarting Buffer Overflow Attacks".
- **C23 and advanced language features:** Modern C (C23 ed.) ch. 16 "Performance" to ch. 19 "Variations in control flow"; Beej ch. 25 "Variadic Functions", ch. 32 "Types Part V: Compound Literals and Generic Selections"; Effective C 2e.
- **Unicode and i18n:** Modern C §14.3–14.5; Beej ch. 26–27.
- **Advanced algorithms:** heaps, balanced trees, graph algorithms in CLRS 4e (chapter numbers beyond 2–3 not verified).
- **Tooling:** fuzzing (libFuzzer/AFL++), static analysis (`clang-tidy`, gcc `-fanalyzer`), CMake/Meson.
- **Other:** embedded/bare-metal C, Rust and C++ FFI.

---

## 7. Total course length
| Part | Modules | Hours | Weeks at 5 h/wk |
|---|---|---|---|
| I · C in the Browser | M1 10, M2 10, M3 10, M4 15, M5 15 | 60 | 12 |
| II · Native C (**CS50 C parity at week 21**) | M6 10, M7 15, M8 20 | 45 | 9 |
| III · Under the Hood | M9 15, M10 10, M11 10, M12 15 | 50 | 10 |
| Capstone + Graduation Check | | 20 | 4 |
| **Total** | 12 modules + capstone | **175 h** | **35 weeks** (+2 optional flex weeks ≈ 8.5 months) |

**Fast lane:** skip Tideman, the optional lessons 4.7/12.8, and the leaderboards. That saves about 10–12 h, bringing the course to roughly 33 weeks.

---

## 8. Constraints and risks for the build and runtime teams
1. **Stack size.** The in-browser default shadow stack is ~64 KiB (≈200 frames, verified). Link with `-Wl,-z,stack-size=8388608`, or M4 and M8 recursion breaks on modest inputs. Even then, the engine's own stack ends deep recursion at ~13k frames with a JS `RangeError` in Node 22; browser limits will differ.
2. **Undefined behaviour does not crash in the browser.** NULL dereferences, writes to string literals and heap overflows are silent there. The pipeline must tag those snippets and store the native output so the [both] panel can show it. UBSan trap mode is the best browser guardrail; it catches NULL, signed overflow and fixed-array bounds, but not heap errors (all verified).
3. **Output comparison.** Compare stdout and stderr **separately**. Interleaving differs between wasm and native (verified). Also normalize `%p` output: ASLR changes addresses between runs.
4. **Toolchain size and speed.** YoWASP clang is a 105 MB download and compiles in ~0.9 s per run in Node. Run learner programs in a Worker separate from the compiler (Node segfault observed when they shared a process).
5. **Native toolchain caveats.**
   - clang ASan on Ubuntu needs `libclang-rt-18-dev`. WSL instructions should default to gcc for sanitizers.
   - Starter Makefiles must stay GNU Make 3.81-compatible (macOS, per docs).
   - Valgrind is Linux/WSL only; use `leaks` on macOS (docs).
6. **Lecture 5 timestamps.** The SRT carries a +1 h offset, so the timestamps given here are corrected and still need checking in the YouTube player. No non-CS50 YouTube IDs were verified.
7. **Modern C chapter numbers.** These come from the free C23-edition PDF; the Manning print edition may number them differently. Both Modern C 3e and Effective C 2e target C23, while the course uses C17, so flag C23-only features when citing them.