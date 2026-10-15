# Build-time pipeline prototypes: C trace generator, sample verifier, local check runner

All three prototypes work on this container. Unless marked **[DOCS]** or **[NOT VERIFIED]**, every result below comes from running the code here.

- **Trace generator (A):** produces correct step-by-step JSON for swap, factorial and the malloc'd linked list in about 0.2 s per program. An optional valgrind pass adds accurate "uninitialised" markers and memory-error messages.
- **Sample verifier (B):** extracts C blocks from MDX, compiles them with gcc and clang, runs them, normalises addresses and writes JSON. 8 lesson samples verify in 1.15 s, or 0.10 s when cached.
- **Check runner (C):** a single-file, zero-dependency Node script. The reference solution passes 9/9 and the buggy starter passes 2/9, with readable messages. The macOS path has not been run on a Mac.

Environment (verified): gcc 13.3.0, Ubuntu clang 18.1.3, GNU gdb 15.1 (Python 3.12.3), valgrind 3.22.0, Node v22.22.0, x86_64. gdb can ptrace in this container. `libc6-dbg 2.39-0ubuntu8.9` is installed.

Root: `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/pipeline/`

---

## A) Trace generator (stack/heap step-through, pre-baked at build time)

### Files
- `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/pipeline/trace/tracer.py` (516 lines). The gdb Python script that steps the program and writes the trace.
- `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/pipeline/trace/heap_shim.c` (1.7 KB). Records malloc/free calls.
- `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/pipeline/trace/trace.sh`. Compiles and runs the tracer.
- `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/pipeline/trace/merge.py`. Merges a native trace with a valgrind trace.
- Sample programs are in `trace/samples/`; output JSON is in `trace/out/`.

### How it works (verified)
1. **Build:**
   ```
   gcc -std=c17 -g -O0 -fno-omit-frame-pointer -fno-inline prog.c heap_shim.o \
       -Wl,--wrap=malloc,--wrap=free,--wrap=calloc,--wrap=realloc
   ```
   - The shim itself is compiled without `-g`, so gdb's `step` never goes into it.
   - `--wrap` only redirects calls made from the learner's object file. Allocations made inside libc (for example stdio buffers) are left out.
   - The shim keeps a table `struct {void*ptr; size_t size; int alive; int id;} __ht_blocks[4096]` that gdb reads with `read_memory` and `struct.unpack("<QQii")`.
   - A shim constructor runs `setvbuf(stdout, NULL, _IONBF, 0)`, which makes "stdout so far" readable after every step.
2. **Run:**
   ```
   TRACE_PROG=bin TRACE_SRC=prog.c TRACE_OUT=out.json gdb -q -nx -batch -x tracer.py
   ```
   - The script runs `break main`, then `run < stdin > out.stdout 2> out.stderr`, then loops on `step`.
   - It sets `set debug-file-directory /nonexistent`. The `libc6-dbg` symbols are present here: an earlier `next` landed in `__libc_start_call_main` with source lines. This setting stops gdb loading them, which is meant to keep `step` from entering printf. I did not run a comparison without it.
   - Fallback: if the newest frame is not in the learner's file, the script `finish`es out to the user frame and then `step`s again.
3. **Each snapshot records:**
   - **Frames:** user frames only, oldest first. For each frame it walks `frame.block()` up through `superblock` to the function block, so only variables in scope appear (verified: a `for (int i…)` variable shows up only inside its loop).
   - **Variables:** name, type, address, size, value, plus `param`, `static` and `declared`.
   - **Globals and statics:** taken from `block.global_block` and `block.static_block`, filtered to the learner's file.
   - **Heap blocks:** pointer targets are resolved against every variable range and live heap block, giving `ref:{kind:local|global|heap|freed, frame, name|id, offset}`.
   - **Heap typing:** each heap block gets its type from the first non-void pointer that points at its start, rendered as `T` or `T[n]` from `size/sizeof(T)`. This repeats as a worklist, so a block reached through `node->next` gets typed too.
4. **Return values:** at a function's closing `}` the script reads `$rax` (or `$xmm0`) cast to the return type. Verified on factorial: returns 1, 2, 6, 24, and main returns 0. This is x86-64 only, and aggregate returns are not captured.
5. **Address normalisation:** each region is rebased separately; offsets within a region are kept real.

   | Region | Fake address formula |
   |---|---|
   | Stack | `0x7ffc00002000 - (main_CFA - addr)` |
   | Heap | `0x55500000 + (addr - heap_start)`; the first user block lands at `0x555002a0` |
   | Executable image | `0x400000 + offset` |
   | libc, garbage, anything else | `0x?NNNN` |

   - Under glibc 2.39 the first user chunk sits at `[heap]+0x2a0`.
   - Results are deterministic because gdb disables ASLR.

### Results (verified)

| Program | Steps | Time (incl. compile) | Compact JSON | gzip -9 |
|---|---|---|---|---|
| swap | 12 | 0.18 s | 7.7 KB | 806 B |
| factorial(4) | 16 | 0.17 s | 10.1 KB | 752 B |
| linked list (3 × malloc, then free) | 51 | 0.19 s | 63.6 KB | 1.9 KB |
| crash (NULL write) | 4 | – | 1.4 KB | – |

- **swap:** `a` and `b` resolve to `{kind:"local",frame:0,name:"x"}` and `name:"y"`, and the x/y values change at the right steps.
- **Linked list:** builds the correct chain #3 → #2 → #1 → NULL. After `free(list)`, `list` shows `ref:{kind:"freed",id:3}` with `dangling:true`, and stdout is `30\n20\n10\n`.
- **Leak sample:** after `s = NULL`, block #1 shows as untyped bytes `68656c6c6f00` with `unreferenced:true`.
- **Crash:** the final step is `{"event":"signal","signal":"SIGSEGV","line":6,"stdout":"about to crash\n"}`.
- **Input:** a scanf sample with stdin `"Ada 36\n"` traced correctly, and `char name[16]` gets a `"str":"Ada"` preview.

**Valgrind mode (`TRACE_VALGRIND=1`)** runs memcheck with `--vgdb=yes --vgdb-error=0`, connects with gdb `target remote | vgdb --pid=N`, and calls `monitor get_vbits 0xADDR LEN` for each variable and heap block. It takes about 2 s per program. On `uninit.c` it gives:
- `arr` → `init:false, vbits:"dddduuuuuuuu"` (only `arr[0]` set);
- the malloc'd block after `buf[1] = 9` → `"uuuudddduuuu"`;
- a use-after-free attached to step 6: `"Invalid read of size 4 … main (uninit.c:12) … block of size 12 free'd … (uninit.c:11) … alloc'd at (uninit.c:8)"`.

Three gotchas found while doing this:
- gdb's `step` swallows the SIGTRAP that vgdb sends when it finds an error, so errors are read from valgrind's `--log-file` instead.
- vgdb needs `--pid` when old FIFOs are still around.
- The inferior pid reports as 42000 on a remote target, so `/proc/<valgrind pid>/maps` has to be read instead.

Heap addresses differ under valgrind because of its redzones. So the native pass is the source of truth for values and addresses, and `merge.py` copies only `init`/`vbits`/`errors` across, after checking that both passes hit the same sequence of lines. This was verified on list and uninit.

### Sample trace JSON (swap, step 7, from a real run)
```json
{"i":7,"line":6,"func":"swap","event":"step",
 "stack":[
  {"func":"main","line":13,"vars":[
    {"name":"x","type":"int","addr":"0x7ffc00001fe0","size":4,"value":{"t":"int","v":2},"param":false,"static":false,"declared":true},
    {"name":"y","type":"int","addr":"0x7ffc00001fe4","size":4,"value":{"t":"int","v":2},"param":false,"static":false,"declared":true}]},
  {"func":"swap","line":6,"vars":[
    {"name":"a","type":"int *","addr":"0x7ffc00001fb8","size":8,"value":{"t":"ptr","v":"0x7ffc00001fe0","ref":{"kind":"local","frame":0,"name":"x","offset":0}},"param":true},
    {"name":"b","type":"int *","addr":"0x7ffc00001fb0","size":8,"value":{"t":"ptr","v":"0x7ffc00001fe4","ref":{"kind":"local","frame":0,"name":"y","offset":0}},"param":true},
    {"name":"tmp","type":"int","addr":"0x7ffc00001fcc","size":4,"value":{"t":"int","v":1},"declared":true}]}],
 "globals":[],"heap":[],"stdout":"before: x=1 y=2\n"}
```
- **Heap entry shape:** `{"id":2,"addr":"0x555002c0","size":16,"type":"node","value":{"t":"struct","fields":[{"name":"value","type":"int","offset":0,"value":{"t":"int","v":20}},{"name":"next","type":"struct node *","offset":8,"value":{"t":"ptr","v":"0x555002a0","ref":{"kind":"heap","id":1,"offset":0}}}]},"init":true}`
- **Top level:** `{version, file, source, steps[], truncated, exit_code, signal, stdout, stderr, address_model}`
- **Other steps can carry:** `event: step|call|return|signal`, `return_value`, `errors[]`.

### Limits (verified unless noted)
- **Line granularity:**
  - Stepping out of a function lands on the caller's next line, because gdb runs the rest of the caller's line silently. So "return" steps show the caller one line later.
  - `for` headers repeat each iteration.
  - Breaking on main can stop on the `{` line when stack-protector code is present.
- **"Uninitialised" without valgrind is only a guess** (`declared = decl_line < current_line`). Garbage values are deterministic under gdb, but glibc-specific. Valgrind mode is accurate.
- **Heap type naming is inconsistent.** A block shows as `node` or `struct node` depending on which pointer typed it first; the frontend should canonicalise. Blocks reached only through `void*` show as raw bytes.
- **Not tracked:** allocations made inside libc (`strdup`, `getline`, `fopen`). Add more `--wrap` entries if lessons need them.
- **Not supported:** threads, signals and `fork`. Arrays are capped at 64 elements; `TRACE_MAX_STEPS` defaults to 1000 and sets `truncated`. Echoed stdin is not shown in stdout.
- **lldb is not usable here:** `python3 -c 'import lldb'` gives a namespace stub with `__file__ = None`. So gdb is the choice for Linux CI.

### Alternatives (assessment, not prototyped)
- **Instrumenting the source at build time** (clang AST rewriting or macros): this means re-implementing scopes, types and the pointer graph that DWARF already gives gdb for free. It also changes the generated code and addresses. Not recommended.
- **Tracing in wasm** (live tracing of code the learner edits): it would need DWARF-in-wasm stepping, a shadow stack, and a binary-instrumentation hook per line. It also uses a different data model. Verified with `clang --target=wasm32 -fsyntax-only` static asserts: wasm32 has `long`=4, `void*`=4, `size_t`=4, `long double`=16. wasm64 has 8/8/8. For comparison, x86_64-windows-msvc has `long`=4. Only worth doing if "visualise your own code" becomes a requirement.
- **From memory, not checked:** Python Tutor's C/C++ backend is also Valgrind-based.

**Recommendation:**
- Use the gdb tracer in a pinned CI image (Ubuntu 24.04, gcc 13, gdb 15, valgrind 3.22), triggered by a `trace` meta flag in the MDX.
- Run native then valgrind, then merge.
- Keep traced programs to one file, roughly 300 steps or fewer, with fixed stdin.
- Ship the JSON gzipped (it compresses about 30×); delta-encode only if traces get large.

---

## B) Sample verification and diff tool

### Files
In `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/pipeline/verify/`:
- `verify.mjs` — the CLI;
- `lib/meta.mjs` — meta parser and MDX extractor;
- `lib/normalize.mjs` — normaliser, rebasing, diagnostics parser, sanitizer summary;
- `lib/toolchains.mjs` — compiler adapters;
- `normalize.test.mjs` — tests, 8/8 pass with `node --test`;
- `lessons/*.mdx` and `neg/neg.mdx` — sample lessons;
- `generated/samples.json` — output.

### Meta syntax for fenced code blocks (implemented)
````
```c id=sizeof-basics predict platform
```c id=sum-stdin predict stdin="3 4\n"
```c id=heap-overflow run sanitize=address,undefined expect=runtime-error
```c id=format-warning expect=warning warn=-Wformat
```c id=say-args run args="one 'two words' \"three\"" timeout=500 compilers=gcc
````

| Key | Meaning |
|---|---|
| `run`, `predict`, `trace` | Bare flags; `predict` and `trace` also imply `run` |
| `id=` | Required for anything runnable; duplicates are an error |
| `stdin=` / `args=` | Quoted with JSON escapes; args split shell-style |
| `expect=` | `success` (default), `warning`, `compile-error`, `runtime-error`, `exit:N`, `ub` |
| `warn=` | Required warning flags |
| `sanitize=` | `address,undefined,…` |
| `compilers=` | Default `gcc,clang` |
| `timeout=` | Milliseconds, default 3000 |
| `norm=` | `ptr`, `all-hex` or `none` |
| `platform` | Output may legitimately differ by data model |
| `std=`, `lm`, `werror=false` | Standard, link `-lm`, drop `-Werror` |

- A fence without `id` (an illustration) is skipped.
- In production, replace the regex extractor with a remark/mdast `code` node visitor (`node.lang`, `node.meta`) so extraction uses the same parser as rendering.

### Pipeline (verified)
1. **Compile** with `gcc|clang -std=c17 -Wall -Wextra -pedantic -g -O0 -fdiagnostics-color=never`.
   - `-Werror` is on unless `expect` is `warning`, `compile-error` or `ub`.
   - With `sanitize=`, add `-fsanitize=… -fno-omit-frame-pointer -fno-sanitize-recover=all`.
2. **Run** with `spawnSync`, passing stdin and args, with a timeout and `SIGKILL`.
   - Environment: `ASAN_OPTIONS=detect_leaks=1:abort_on_error=0:exitcode=86`, `UBSAN_OPTIONS=print_stacktrace=1:halt_on_error=1:exitcode=87`.
   - **Gotcha found:** also setting `LSAN_OPTIONS=exitcode=88` overrode ASan's exit code, because `exitcode` is a common flag (heap-overflow exited 88). Leaks are classified from stderr instead.
3. **Normalise.** One `Map` per run, so stdout and stderr tokens stay consistent:
   - hex numbers with 5 or more digits become `<addrN>` in order of first appearance;
   - `(nil)` and `0x0` become `<NULL>`;
   - `==PID==` and the temp directory are replaced with fixed tokens;
   - `0xff` stays as written.
4. **Check `expect`, compare gcc with clang** (normalised stdout and exit code), store a line diff, set `canonical` = gcc output, and write the JSON.
   - The content-hash cache key is code + meta + compiler versions + a hash of the verifier's own source. That last part fixed a real stale-cache bug I hit.

### Normaliser core
```js
s = s.replace(/\(nil\)|\b0x0+\b/g, "<NULL>");
s = s.replace(/\b0x[0-9a-fA-F]{5,}\b/g, (hex) => {
  const key = hex.toLowerCase().replace(/^0x0+(?=.)/, "0x");
  if (!map.has(key)) map.set(key, `<addr${map.size + 1}>`);
  return map.get(key);
});
```

**Display addresses (added):** `rebaseAddresses()` clusters addresses that are within 1 MiB of each other and rebases each cluster to a fixed base:
- stack clusters keep only 16-byte alignment, since Linux also randomises the stack's page offset;
- heap and image clusters keep their page offset.

The result is the same across ASLR runs and keeps the offsets inside each cluster: `&a=0x7ffd4a3c1bc0 &b=0x7ffd4a3c1bc4 h1=0x55d0c24002a0 h2=0x55d0c24002c0 &g=0x55d0c1400010`, identical over 5 runs. It is stored as `stdoutDisplay`, so lessons can still show that `&b` is 4 bytes after `&a`. Token-normalised output is for comparison; rebased output is for display.

### Results (8 lesson samples + 3 negative samples)
- **Lesson samples:** all pass except `unused-var-oops`, which fails under `-Werror` on both compilers as intended. `--force` takes 1150 ms; cached takes 102 ms.
- **`pointer-addresses`** raw output:
  `&a = 0x7ffc1113c390 / &b = …394 / p = …390 / q = (nil) / 0xff`
  - normalised: `&a = <addr1>`, `&b = <addr2>`, `p = <addr1> (same as &a? yes)`, `q = <NULL>`, `hex literal stays: 0xff`.
- **`sizeof-basics`:** `char 1, int 4, long 8, long long 8, void * 8`. gcc and clang agree.
- **`sum-stdin`:** `3 + 4 = 7`.
- **Diagnostic flag spelling differs** between compilers, and the parser now normalises it (covered by a unit test):

  | | gcc | clang |
  |---|---|---|
  | format warning | `[-Wformat=]` | `[-Wformat]` |
  | promoted to error | `[-Werror=unused-variable]` | `[-Werror,-Wunused-variable]` |

- **UB samples:** `uninit-ub` printed 32767 with gcc and -993738216 with clang; this is logged as `info` because of `expect=ub`. Running `printf("%d", 3.5)` also gave different garbage, so warning demos shouldn't be `run`.
- **Sanitizers:**
  - gcc's ASan, UBSan and LSan all work. The summary output: `{"tool":"AddressSanitizer","kind":"heap-buffer-overflow","access":"WRITE of size 4","frames":["main <tmp>/heap-overflow.c:8","main <tmp>/heap-overflow.c:4"]}`, exit 86. LSan reported `Direct leak of 10 byte(s)`.
  - **This container's clang 18 has no compiler-rt**: `cannot find …/libclang_rt.asan_static-x86_64.a`, and `apt-get download libclang-rt-18-dev` reports no candidate. The tool marks this as `warn: sanitizer runtime not installed` instead of failing. The CI image must install `libclang-rt-18-dev`.
- **Negative samples:** the infinite loop was flagged "timed out after 500 ms" on both compilers. Args with quotes came through as `[one] [two words] [three]`.

### Interface for the wasm half (design)
```ts
interface Toolchain {
  name: "gcc" | "clang" | "wasm-clang"; abi: "lp64" | "ilp32";
  version(): Promise<string>;
  compile(r: {dir; sources: {name; code}[]; std; werror; sanitize: string[]; lm?})
    : Promise<{ok; exitCode; stderr; diagnostics: {file,line,col,severity,message,flag}[]; artifact?; command}>;
  run(artifact, o: {stdin; args; timeoutMs; cwd}): Promise<{exitCode; signal; stdout; stderr; timedOut; durationMs}>;
}
```
- The @yowasp/clang adapter should compile to wasm32-wasi, run under `node:wasi`, report `abi:"ilp32"`, and skip `sanitize` samples.
- **Diff policy:**
  - compare wasm against gcc using normalised stdout and exit code;
  - compare diagnostics by (line, severity, normalised flag), not by message text, since clang versions word things differently;
  - known divergence classes to allow, or flag as `platform`/`ub`: `sizeof(long)`, pointer and `size_t` widths, `long double`, uninitialised values and UB, stack layout, `strerror` text.
- Store the wasm result next to the native one, so a lesson can say "your browser (wasm32): 4; a 64-bit Mac or Linux: 8".
- **Recommendation:** answers to `predict` questions come from gcc (LP64), and gcc and clang must agree unless the sample is `platform` or `ub`. Commit only normalised and display output; raw addresses would change on every build.

---

## C) Local project test runner (`node check.mjs`)

### Files
In `/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/pipeline/check/`:
- `check.mjs` — 307 lines, 18.5 KB, Node 18+, no dependencies;
- `caesar/check.json`, `caesar/caesar.c` (buggy starter), `caesar/tests/test_rotate.c` — the sample exercise;
- `solutions/caesar.c` — reference solution;
- `variants/leaky.c`, `variants/syntax.c` — extra test inputs.

### Design
- **Usage:** `node check.mjs [dir] [--src f.c] [--only "name"] [--verbose] [--json] [--cc gcc] [--keep]`. Exit code 0 means everything passed.
- **Compiler choice:** `--cc`, then `$CC`, then `cc`, `clang`, `gcc`. If none is found it prints a friendly install hint (`xcode-select --install` on macOS, `apt install build-essential` on Linux/WSL).
- **Builds** go to a temp directory and are built lazily:
  - `plain`: `-std=c17 -Wall -Wextra -pedantic -g -O0 -lm`;
  - `asan`: adds `-fsanitize=address,undefined -fno-sanitize-recover=all`;
  - `unit:<harness>`: the test harness built against the learner's code.
- **Test types in `check.json`:**
  - `compile` (optionally `warnings:false`);
  - `run` (the default) — `args`, `stdin`, `stdout`/`stderr` as an exact string or `{equals|contains|matches|trim}`, `exit`, `files`, `timeoutMs`, `hint`;
  - `unit` — a C harness;
  - `memory`.
- If the code doesn't compile, every other test is skipped with "can't check until it compiles".
- **Unit harness:** `check.mjs` writes its own embedded `check.h` (`CHECK`, `CHECK_EQ_INT`, `CHECK_EQ_CHAR`, `CHECK_EQ_STR`, which print `@@PASS name` / `@@FAIL name\twhy`). The harness pulls in the learner's file like this, so static functions can be tested too:
  ```c
  #include "check.h"
  #define main learner_main
  #include LEARNER_SRC        /* passed as -DLEARNER_SRC="/abs/caesar.c" */
  #undef main
  ```
  If the harness crashes, the runner reports `(remaining unit tests)`. Possible improvement: run one case per process.
- **Memory checks by platform:**

  | Platform | Errors (overflow, use-after-free, UB) | Leaks |
  |---|---|---|
  | Linux / WSL | ASan + UBSan | LSan (built into ASan) |
  | Linux without sanitizer runtime | valgrind on the plain build | valgrind |
  | macOS (Apple clang) | ASan + UBSan with `detect_leaks=0` | `leaks --atExit -- ./plain` with `MallocStackLogging=1` |

  - Valgrind also runs on Linux when `valgrind:true` is set; it uses a separate plain build because it can't be combined with ASan.
  - Sanitizer support is probed by compiling and running a tiny program first.
  - If no leak checker ran, the output says so in yellow: `leaks NOT checked`.
- Output: ✓/✗/– with colour on a TTY, plain ASCII on Windows, and `NO_COLOR` is respected.
  - Strings are shown with escapes, and invalid UTF-8 appears as `\x89` rather than replacement characters.
  - Exact-match failures point to the first differing character, and signals get plain-English explanations.

### Verified output (gcc on Linux)
- Reference solution: **9/9 pass in 440 ms**, including the 5 unit subtests and the "AddressSanitizer + UBSan + LeakSanitizer" memory check.
- Starter, abridged:
```
✗ compiles without warnings
    caesar.c:14: unused parameter 'argc' [-Wunused-parameter]
    hint: Fix every warning: the course builds with -Wall -Wextra -pedantic.
✗ encrypts "barfoo" with key 23 as "yxocll"
    ran:       ./caesar 23   with input "barfoo\n"
    expected stdout exactly: "ciphertext: yxocll\n"
    actual stdout:   "ciphertext: yx\x89}\x86\x86\n"
    first difference on line 1, character 15
✗ rejects a missing key
    ran:       ./caesar
    it crashed with a segmentation fault (it touched memory it doesn't own -- often a NULL or out-of-bounds pointer)
    hint: Check argc before you touch argv[1].
✗ rotate() unit tests
    ✓ rotate('a', 1) gives 'b'
    ✗ rotate('z', 1) wraps to 'a'
        expected 'a' (97), got '{' (123)
✗ no memory errors or leaks
    heap-buffer-overflow: write of 1 byte(s) 0 bytes after a 6-byte block
    at main() at caesar.c:26 (block allocated at main() at caesar.c:22)
2/9 checks passed.  Fix the first failure, then run `node check.mjs` again.
```
- **Starter scores:** it first scored 3/9, about 517 ms. The "non-numeric key" test passed by accident: it exited 1 only because stdin was empty. After adding stdin and a stderr assertion it scores 2/9. Lesson for test authors: negative tests should always supply stdin and assert on the output.
- **Leak only:**
  - gcc: `memory leak: 7 byte(s) malloc'd but never freed  at main() at leaky.c:42`;
  - `CC=clang` (no sanitizer runtime, so valgrind is used automatically): `valgrind: 7 bytes in 1 blocks are definitely lost… at leaky.c:42`;
  - starter under clang/valgrind: `valgrind: Invalid write of size 1 at caesar.c:26`.
- **Other paths:** a syntax error gives `✗ compiles — syntax.c:50: expected ';' before 'free'`, then skips the rest. `--json` emits `{exercise, compiler, platform, passed, total, results[]}`. With `CHECK_PLATFORM=darwin` simulated on Linux and no `leaks` binary, it prints "leaks NOT checked".
- **[NOT VERIFIED]** Real macOS: Apple clang ASan on arm64, `leaks --atExit` output parsing (it looks for `/(\d+) leaks? for (\d+) total leaked bytes/`), and the `MallocNanoZone=0` setting. Everything on WSL is expected to behave like Linux.

### LeakSanitizer on macOS
**[DOCS]** — read from compiler-rt source on raw.githubusercontent and from search results, not run:
- In upstream `lsan_common.h`, `CAN_SANITIZE_LEAKS` is 1 for `(SANITIZER_LINUX || SANITIZER_APPLE) && 64-bit && (x86_64 || aarch64 …)`. So upstream LLVM does build leak detection for Apple 64-bit.
- In `sanitizer_flags.inc`, `detect_leaks` defaults to `!SANITIZER_APPLE`, i.e. off on Apple.
- In `asan_flags.cpp`, if `!CAN_SANITIZE_LEAKS && detect_leaks` it prints `"detect_leaks is not supported on this platform."` and dies.
- Reports say Apple's Xcode clang doesn't support leak detection (MacPorts ticket, Squeak list). The rust-lang issue reports LSan unsupported on aarch64 macOS. Even non-Apple LLVM is reportedly noisy on macOS 13+ with Apple Silicon.

That supports the plan: never set `detect_leaks=1` on macOS; use `leaks --atExit` on a plain build. Per the `leaks(1)` synopsis, `MallocStackLogging` gives allocation sites, and a secondary source says a nonzero exit status means leaks were found.

### Recommendations
- Ship `check.mjs` (identical across exercises) plus a `check.json` with each exercise download or in the starter repo.
- Native Windows is not supported; point learners to WSL.
- Keep the same exercise and solution pairs in CI: every reference solution must pass, and every starter must fail at least one test.

Sources:
- [MacPorts ticket 68079](https://trac.macports.org/ticket/68079)
- [Squeak vm-dev thread](https://lists.squeakfoundation.org/archives/list/vm-dev@lists.squeakfoundation.org/thread/ZU65NYCJLIOUVL25GB6MH6OLYCSEQQNE/)
- [LLVM Discourse: LSan on macOS 13 Apple Silicon](https://discourse.llvm.org/t/does-leaksanitizer-not-work-on-macos-13-apple-silicon/73148)
- [rust-lang/rust#98473](https://github.com/rust-lang/rust/issues/98473)
- [LeakSanitizer.rst (llvm.googlesource)](https://llvm.googlesource.com/llvm-project/+/refs/heads/main/clang/docs/LeakSanitizer.rst)
- [leaks(1) man page](https://leancrew.com/all-this/man/man1/leaks.html)
- [0110.be: identifying memory leaks in C](https://0110.be/posts/Identifying_memory_leaks_in_C)
- [Apple malloc debug env vars](https://developer.apple.com/library/mac/releasenotes/DeveloperTools/RN-MallocOptions)
- [Apple forums thread 741187](https://developer.apple.com/forums/thread/741187)
- compiler-rt sources fetched from raw.githubusercontent.com: `lib/lsan/lsan_common.h`, `lib/asan/asan_flags.cpp`, `lib/sanitizer_common/sanitizer_flags.inc`