#!/usr/bin/env bash
# Proves the CI toolchain works here: versions first (`--versions` stops there), then real compiles, sanitizers that
# catch a bug, valgrind that finds a leak, and both debuggers. Checks the commands the tools actually call: GCC
# (default gcc), CLANG22 (clang-22), LLDB22 (lldb-22). Installs nothing. Prints Ready only when every check passed.
set -euo pipefail
umask 022
export LC_ALL=C
gcc=${GCC:-gcc} clang=${CLANG22:-clang-22} lldb=${LLDB22:-lldb-22}
fail() { echo "$1" >&2; exit 1; }
check() {
  local tool=$1 pattern=$2 output
  if ! output=$(timeout 20 "$tool" --version 2>&1) || ! grep -Eq "$pattern" <<< "$output"; then
    fail "Missing or incompatible $tool (expected $pattern)."
  fi
  echo "$tool: $(head -1 <<< "$output")"
}
check "$gcc" '^gcc.* 13\.[0-9]+\.[0-9]+'
[[ "$gcc" == gcc ]] || check gcc '^gcc.* 13\.[0-9]+\.[0-9]+' # tools/trace calls plain gcc
check "$clang" 'clang version 22\.'
check "$lldb" 'lldb version 22\.'
check gdb 'GNU gdb .*15\.'
check valgrind 'valgrind-3\.22\.'
node=$(timeout 20 node --version 2>&1) || fail 'Missing node.'
[[ "$node" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || fail "Unrecognised node version $node."
# Only the major version is checked (owner's decision on #110): any Node 22 passes, as npm ci only warns about
# package.json engines and CI's setup-node gives the latest 22.
(( BASH_REMATCH[1] >= 22 )) || fail "Node $node is older than 22, which CI runs. The container backend ships 22.22.2: npm run setup -- --container."
(( BASH_REMATCH[1] == 22 )) || echo "warning: node $node; CI runs Node 22." >&2
echo "node: $node"
for tool in make llvm-symbolizer-22 ffmpeg python3; do
  command -v "$tool" >/dev/null || fail "Missing $tool."
done
[[ "${1:-}" == --versions ]] && exit 0

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
probe() { # probe <what> <expected exit: 0 or "fail"> <pattern> <command...>: run with a timeout, keep its output.
  local what=$1 want=$2 pattern=$3 status=0; shift 3
  timeout 30 "$@" > "$scratch/out.log" 2>&1 || status=$?
  if (( status == 124 )) || { [[ $want == 0 ]] && (( status != 0 )); } || { [[ $want == fail ]] && (( status == 0 )); } \
     || { [[ -n $pattern ]] && ! grep -Eq "$pattern" "$scratch/out.log"; }; then
    cat "$scratch/out.log" >&2
    fail "$what failed (exit $status, expected ${want/fail/non-zero}${pattern:+ and output matching /$pattern/})."
  fi
}
cat > "$scratch/ok.c" <<'C'
int main(void) { volatile int n = 42; return n == 42 ? 0 : 1; }
C
cat > "$scratch/overflow.c" <<'C'
#include <stdlib.h>
int main(void) { char *p = malloc(4); volatile int i = 4; p[i] = 1; free(p); return 0; }
C
cat > "$scratch/leak.c" <<'C'
#include <stdlib.h>
int main(void) { volatile char *p = malloc(64); p[0] = 1; p = 0; return 0; }
C
flags=(-std=c17 -Wall -Wextra -pedantic -g)
for cc in "$gcc" "$clang"; do
  probe "$cc compile" 0 '' "$cc" "${flags[@]}" -fsanitize=address,undefined "$scratch/ok.c" -o "$scratch/ok"
  probe "$cc sanitized run" 0 '' "$scratch/ok"
  probe "$cc overflow program" 0 '' "$cc" "${flags[@]}" -fsanitize=address "$scratch/overflow.c" -o "$scratch/overflow"
  probe "AddressSanitizer ($cc) catching a heap overflow" fail 'AddressSanitizer: heap-buffer-overflow' "$scratch/overflow"
done
# valgrind needs programs built without sanitizers.
probe "$gcc leak program" 0 '' "$gcc" -g "$scratch/leak.c" -o "$scratch/leak"
probe "$gcc plain program" 0 '' "$gcc" -g "$scratch/ok.c" -o "$scratch/plain"
probe 'valgrind finding a leak' fail 'definitely lost: 64 bytes' valgrind --leak-check=full --error-exitcode=99 "$scratch/leak"
probe 'valgrind on a clean program' 0 'ERROR SUMMARY: 0 errors' valgrind --leak-check=full --error-exitcode=99 "$scratch/plain"
probe "$clang debug build" 0 '' "$clang" -g "$scratch/ok.c" -o "$scratch/debug"
probe 'GDB reaching a breakpoint' 0 'Breakpoint 1, main' gdb -q -nx -batch -ex 'break main' -ex run "$scratch/debug"
# gdb still stops at the breakpoint when the sandbox blocks personality(); it only warns, and addresses then vary.
if grep -q 'Error disabling address space randomization' "$scratch/out.log"; then
  cat "$scratch/out.log" >&2
  fail 'GDB cannot disable address space randomization here (seccomp or ptrace limits); its sessions would differ from CI.'
fi
probe 'GDB Python' 0 '^tdcc-42$' gdb -q -nx -batch -ex 'python print("tdcc-" + str(6 * 7))'
probe 'LLDB reaching a breakpoint' 0 'stop reason = breakpoint' "$lldb" -b -x -o 'breakpoint set --name main' -o run -o 'process kill' "$scratch/debug"
echo 'Ready: GCC and Clang with sanitizers, valgrind, GDB (with Python) and LLDB passed functional checks.'
