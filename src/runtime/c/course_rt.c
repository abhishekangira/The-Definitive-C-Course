/* course_rt.c - linked into every program built by the in-browser toolchain.
 * wasi-libc (musl) does not flush stdout before blocking on stdin, so a prompt printed with
 * printf("n? ") would stay invisible. The JS stdin hook calls this export before every wait. */
#include <stdio.h>

__attribute__((export_name("__course_flush_stdout")))
void __course_flush_stdout(void) { fflush(stdout); }
