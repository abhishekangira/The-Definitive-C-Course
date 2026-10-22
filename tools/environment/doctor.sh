#!/usr/bin/env bash
set -euo pipefail
umask 022
export LC_ALL=C
check() {
  local tool=$1 pattern=$2 output
  if ! output=$("$tool" --version 2>&1) || ! grep -Eq "$pattern" <<< "$output"; then
    echo "Missing or incompatible $tool (expected $pattern). Run npm run setup." >&2
    exit 1
  fi
  head -1 <<< "$output"
}
check gcc-13 '13\.[0-9]'
check clang-22 'clang version 22\.'
check lldb-22 'lldb version 22\.'
check gdb 'GNU gdb .*15\.'
check valgrind 'valgrind-3\.22\.'
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); if(a<22 || (a===22 && (b<22 || (b===22 && c<2)))) process.exit(1)' || { echo 'Node >=22.22.2 is required.' >&2; exit 1; }
node --version
for tool in make llvm-symbolizer-22 ffmpeg python3; do
  command -v "$tool" >/dev/null || { echo "Missing $tool; run npm run setup." >&2; exit 1; }
done
[[ "${1:-}" == --versions ]] && exit 0
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
echo 'int main(void) { volatile int n = 42; return n == 42 ? 0 : 1; }' > "$scratch/main.c"
for compiler in gcc-13 clang-22; do
  "$compiler" -std=c17 -Wall -Wextra -pedantic -g -fsanitize=address,undefined "$scratch/main.c" -o "$scratch/program"
  "$scratch/program"
done
clang-22 -g "$scratch/main.c" -o "$scratch/debug"
debugger() {
  local pattern=$1; shift
  if ! timeout 20 "$@" > "$scratch/debugger.log" 2>&1 || ! grep -q "$pattern" "$scratch/debugger.log"; then
    cat "$scratch/debugger.log" >&2
    exit 1
  fi
}
debugger 'Breakpoint 1, main' gdb -q -nx -batch -ex 'break main' -ex run "$scratch/debug"
debugger 'stop reason = breakpoint' lldb-22 -b -x -o 'breakpoint set --name main' -o run -o 'process kill' "$scratch/debug"
echo 'Ready: both compilers, sanitizers, GDB and LLDB passed functional checks.'
