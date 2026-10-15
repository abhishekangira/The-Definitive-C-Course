/* heap_shim.c - linked into traced programs with
 *   -Wl,--wrap=malloc,--wrap=free,--wrap=calloc,--wrap=realloc
 * Only calls made from the sample's own object file are redirected here, so libc-internal
 * allocations (stdio buffers, ...) are not tracked. Compiled WITHOUT -g so gdb's `step` never
 * enters it. tracer.py reads __ht_blocks / __ht_count straight from the inferior's memory
 * (struct layout "<QQii": ptr, size, alive, id -> 24 bytes on x86-64). */
#include <stdio.h>
#include <stdlib.h>

#define HT_MAX 4096
struct ht_block { void *ptr; size_t size; int alive; int id; };
struct ht_block __ht_blocks[HT_MAX];
int __ht_count = 0;
int __ht_bad_free = 0; /* free() of an unknown or already-freed pointer */

void *__real_malloc(size_t);
void __real_free(void *);
void *__real_calloc(size_t, size_t);
void *__real_realloc(void *, size_t);

static void ht_add(void *p, size_t n) {
    if (p && __ht_count < HT_MAX) {
        __ht_blocks[__ht_count] = (struct ht_block){ p, n, 1, __ht_count + 1 };
        __ht_count++;
    }
}

static int ht_kill(void *p) {
    for (int i = __ht_count - 1; i >= 0; i--)
        if (__ht_blocks[i].ptr == p && __ht_blocks[i].alive) { __ht_blocks[i].alive = 0; return 1; }
    return 0;
}

void *__wrap_malloc(size_t n) { void *p = __real_malloc(n); ht_add(p, n); return p; }
void *__wrap_calloc(size_t c, size_t n) { void *p = __real_calloc(c, n); ht_add(p, c * n); return p; }
void __wrap_free(void *p) { if (p && !ht_kill(p)) __ht_bad_free++; __real_free(p); }
void *__wrap_realloc(void *old, size_t n) {
    void *p = __real_realloc(old, n);
    if (p) { if (old) ht_kill(old); ht_add(p, n); }
    return p;
}

/* Unbuffered stdout so the tracer can read "stdout so far" after every step. */
__attribute__((constructor)) static void ht_init(void) { setvbuf(stdout, NULL, _IONBF, 0); }
