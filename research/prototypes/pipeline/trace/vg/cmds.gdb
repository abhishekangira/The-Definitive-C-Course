set pagination off
set debug-file-directory /nonexistent
target remote | vgdb --vgdb-prefix=/tmp/claude-0/-home-user-the-definitive-c-course/7798c440-801e-5a1a-9390-b579b459dbdf/scratchpad/research/pipeline/trace/vg/vgdb-pipe
break main
continue
next
info locals
eval "monitor get_vbits 0x%lx 4", (long)&a
eval "monitor get_vbits 0x%lx 4", (long)&b
eval "monitor get_vbits 0x%lx 12", (long)&arr
next
next
next
eval "monitor get_vbits 0x%lx 4", (long)&a
eval "monitor get_vbits 0x%lx 12", (long)&arr
continue
