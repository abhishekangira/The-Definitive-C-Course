#!/bin/sh
# usage: trace.sh prog.c out.json [stdin-file]
set -e
D=$(cd "$(dirname "$0")" && pwd)
SRC=$(realpath "$1"); OUT=$(realpath "$2"); IN=${3:-/dev/null}
BIN="${OUT%.json}.bin"
[ -f "$D/heap_shim.o" ] || gcc -O1 -c "$D/heap_shim.c" -o "$D/heap_shim.o"
gcc -std=c17 -g -O0 -fno-omit-frame-pointer -fno-inline "$SRC" "$D/heap_shim.o" \
    -Wl,--wrap=malloc,--wrap=free,--wrap=calloc,--wrap=realloc -o "$BIN"
TRACE_PROG="$BIN" TRACE_SRC="$SRC" TRACE_OUT="$OUT" TRACE_STDIN="$IN" \
    gdb -q -nx -batch -x "$D/tracer.py" 2>&1 | grep -v '^\[Inferior\|^Breakpoint\|^$' || true
