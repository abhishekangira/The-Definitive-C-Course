/* Linked into every learner program. Lets the JS host flush stdout right before
   blocking on stdin, matching glibc-on-a-terminal behaviour (prompt appears before input). */
#include <stdio.h>
__attribute__((export_name("__course_flush_stdout")))
void __course_flush_stdout(void) { fflush(stdout); }
