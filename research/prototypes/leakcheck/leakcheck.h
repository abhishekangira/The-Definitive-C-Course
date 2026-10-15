/* leakcheck.h: injected with -include; browser-side allocation checker (wasm has no ASan). */
#ifndef LEAKCHECK_H
#define LEAKCHECK_H
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct lc_blk { struct lc_blk *next; size_t n; const char *file; int line; } lc_blk;
#define LC_HDR ((sizeof(lc_blk) + _Alignof(max_align_t) - 1) / _Alignof(max_align_t) * _Alignof(max_align_t))
#define LC_PAY(b) ((void *)((unsigned char *)(b) + LC_HDR))
#define LC_CANARY 0xFD
static lc_blk *lc_head; static int lc_errors;
static inline void lc_report(void) {
    size_t nb = 0, bytes = 0;
    for (lc_blk *b = lc_head; b; b = b->next) { nb++; bytes += b->n;
        fprintf(stderr, "LEAK: %zu bytes allocated at %s:%d never freed\n", b->n, b->file, b->line); }
    fprintf(stderr, "leakcheck: %zu block(s), %zu byte(s) leaked; %d heap error(s)\n", nb, bytes, lc_errors);
}
static inline void *lc_malloc(size_t n, const char *f, int l) {
    static int init; if (!init) { init = 1; atexit(lc_report); }
    lc_blk *b = (malloc)(LC_HDR + n + 8);
    if (!b) return NULL;
    b->n = n; b->file = f; b->line = l; b->next = lc_head; lc_head = b;
    memset((unsigned char *)LC_PAY(b) + n, LC_CANARY, 8);
    return LC_PAY(b);
}
static inline lc_blk *lc_find(void *p, int unlink) {
    for (lc_blk **pp = &lc_head; *pp; pp = &(*pp)->next)
        if (LC_PAY(*pp) == p) { lc_blk *b = *pp; if (unlink) *pp = b->next; return b; }
    return NULL;
}
static inline void lc_free(void *p, const char *f, int l) {
    if (!p) return;
    lc_blk *b = lc_find(p, 1);
    if (!b) { fprintf(stderr, "INVALID FREE: %p at %s:%d (double free or not from malloc)\n", p, f, l); lc_errors++; return; }
    unsigned char *c = (unsigned char *)p + b->n;
    for (int i = 0; i < 8; i++) if (c[i] != LC_CANARY) {
        fprintf(stderr, "HEAP OVERFLOW: wrote past end of %zu-byte block from %s:%d (detected at %s:%d)\n", b->n, b->file, b->line, f, l);
        lc_errors++; break; }
    (free)(b);
}
static inline void *lc_calloc(size_t k, size_t n, const char *f, int l) {
    if (n && k > (size_t)-1 / n) return NULL;
    void *p = lc_malloc(k * n, f, l); if (p) memset(p, 0, k * n); return p;
}
static inline void *lc_realloc(void *p, size_t n, const char *f, int l) {
    if (!p) return lc_malloc(n, f, l);
    lc_blk *old = lc_find(p, 0);
    if (!old) { fprintf(stderr, "INVALID REALLOC: %p at %s:%d\n", p, f, l); lc_errors++; return NULL; }
    void *q = lc_malloc(n, f, l); if (!q) return NULL;
    memcpy(q, p, old->n < n ? old->n : n); lc_free(p, f, l); return q;
}
#define malloc(n) lc_malloc((n), __FILE__, __LINE__)
#define calloc(k, n) lc_calloc((k), (n), __FILE__, __LINE__)
#define realloc(p, n) lc_realloc((p), (n), __FILE__, __LINE__)
#define free(p) lc_free((p), __FILE__, __LINE__)
#endif
