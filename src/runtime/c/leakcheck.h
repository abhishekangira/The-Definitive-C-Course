/* leakcheck.h - force-included (-include leakcheck.h) when an exercise checks for leaks in the browser.
 *
 * These function-like macros only record *where* a call happens. The bookkeeping lives in leakcheck.c,
 * which owns one global registry and also intercepts every call via the linker (-Wl,--wrap=...), so:
 *   - memory may be allocated in one file and freed in another;
 *   - `free` (or `malloc`) passed as a function pointer still works: a function-like macro is not
 *     expanded without "(", so the call reaches the --wrap'd function (just without a line number);
 *   - allocations libc makes for its own internal caches carry no learner location and are ignored.
 * Limitation: a struct member called free/malloc/calloc/realloc cannot be called as a.free(p).
 */
#ifndef LEAKCHECK_H
#define LEAKCHECK_H
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void *lc_malloc_at(size_t n, const char *file, int line);
void *lc_calloc_at(size_t count, size_t n, const char *file, int line);
void *lc_realloc_at(void *p, size_t n, const char *file, int line);
void lc_free_at(void *p, const char *file, int line);
/* Re-tags a block that libc allocated on the caller's behalf (strdup, getline...) with the call site. */
void *lc_tag(void *p, const char *file, int line);
long lc_tag_line(long r, char **lineptr, const char *file, int line);

#define malloc(n) lc_malloc_at((n), __FILE__, __LINE__)
#define calloc(c, n) lc_calloc_at((c), (n), __FILE__, __LINE__)
#define realloc(p, n) lc_realloc_at((p), (n), __FILE__, __LINE__)
#define free(p) lc_free_at((p), __FILE__, __LINE__)
#define strdup(s) ((char *)lc_tag((strdup)(s), __FILE__, __LINE__))
#define strndup(s, n) ((char *)lc_tag((strndup)((s), (n)), __FILE__, __LINE__))
#define getline(l, n, f) lc_tag_line((long)(getline)((l), (n), (f)), (l), __FILE__, __LINE__)
#define getdelim(l, n, d, f) lc_tag_line((long)(getdelim)((l), (n), (d), (f)), (l), __FILE__, __LINE__)

#endif
