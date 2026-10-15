/* leakcheck.c - heap checker for the in-browser toolchain (wasm32 has no AddressSanitizer).
 *
 * Linked with -Wl,--wrap=malloc,--wrap=calloc,--wrap=realloc,--wrap=free, so every call in the
 * program (in any file, and through function pointers) goes through one global registry.
 * Detects: leaks at exit, writes past the end of a block (8-byte canary checked at free and at exit),
 * double/invalid free and realloc of unknown pointers. Blocks without a learner source location
 * (libc's own internal caches) are not reported. It cannot see out-of-bounds reads,
 * use-after-free or stack errors; native AddressSanitizer (Module 3+) covers those.
 *
 * The report is written as JSON lines to the file ".leakcheck" in the WASI filesystem, so it never
 * mixes with the program's own stdout/stderr. The test runner reads it after the program exits.
 */
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void *__real_malloc(size_t n);
void *__real_calloc(size_t c, size_t n);
void *__real_realloc(void *p, size_t n);
void __real_free(void *p);

#define CANARY_BYTES 8
#define CANARY 0xFD

typedef struct Block {
    void *ptr;
    size_t size;
    const char *file;
    int line;
    unsigned long seq;
    struct Block *next;
} Block;

#define BUCKETS 1024
static Block *table[BUCKETS];
static unsigned long next_seq = 1;
static int registered;
static int reporting; /* the report's own fopen/fclose must not be tracked */

typedef struct Event { char kind[16]; size_t size; const char *file; int line; struct Event *next; } Event;
static Event *events, **events_tail = &events;

static unsigned bucket(const void *p) { return (unsigned)(((uintptr_t)p >> 4) % BUCKETS); }

static void note(const char *kind, size_t size, const char *file, int line) {
    Event *e = __real_malloc(sizeof *e);
    if (!e) return;
    strncpy(e->kind, kind, sizeof e->kind - 1);
    e->kind[sizeof e->kind - 1] = '\0';
    e->size = size; e->file = file; e->line = line; e->next = NULL;
    *events_tail = e; events_tail = &e->next;
}

static int canary_ok(const Block *b) {
    const unsigned char *c = (const unsigned char *)b->ptr + b->size;
    for (int i = 0; i < CANARY_BYTES; i++) if (c[i] != CANARY) return 0;
    return 1;
}

static void json_str(FILE *f, const char *s) {
    fputc('"', f);
    for (; s && *s; s++) { if (*s == '"' || *s == '\\') fputc('\\', f); fputc(*s, f); }
    fputc('"', f);
}

static void report(void) {
    reporting = 1;
    FILE *f = fopen(".leakcheck", "w");
    if (!f) return;
    for (Event *e = events; e; e = e->next) {
        fprintf(f, "{\"type\":\"%s\",\"bytes\":%lu,\"file\":", e->kind, (unsigned long)e->size);
        json_str(f, e->file ? e->file : "");
        fprintf(f, ",\"line\":%d}\n", e->line);
    }
    for (unsigned i = 0; i < BUCKETS; i++)
        for (Block *b = table[i]; b; b = b->next) {
            if (!b->file) continue; /* libc's own internal allocations (e.g. path caches) */
            if (!canary_ok(b)) {
                fprintf(f, "{\"type\":\"overflow\",\"bytes\":%lu,\"file\":", (unsigned long)b->size);
                json_str(f, b->file ? b->file : "");
                fprintf(f, ",\"line\":%d}\n", b->line);
            }
            fprintf(f, "{\"type\":\"leak\",\"bytes\":%lu,\"file\":", (unsigned long)b->size);
            json_str(f, b->file ? b->file : "");
            fprintf(f, ",\"line\":%d,\"seq\":%lu}\n", b->line, b->seq);
        }
    fclose(f);
}

static void *track(void *raw, size_t n, const char *file, int line) {
    if (!raw) return NULL;
    if (!registered) { registered = 1; atexit(report); }
    memset((unsigned char *)raw + n, CANARY, CANARY_BYTES);
    Block *b = __real_malloc(sizeof *b);
    if (!b) return raw;
    b->ptr = raw; b->size = n; b->file = file; b->line = line; b->seq = next_seq++;
    unsigned k = bucket(raw);
    b->next = table[k]; table[k] = b;
    return raw;
}

static Block *untrack(void *p) {
    for (Block **pp = &table[bucket(p)]; *pp; pp = &(*pp)->next)
        if ((*pp)->ptr == p) { Block *b = *pp; *pp = b->next; return b; }
    return NULL;
}

static void *do_malloc(size_t n, const char *file, int line) {
    if (reporting) return __real_malloc(n);
    if (n > SIZE_MAX - CANARY_BYTES) return NULL;
    return track(__real_malloc(n + CANARY_BYTES), n, file, line);
}

static void *do_calloc(size_t c, size_t n, const char *file, int line) {
    if (reporting) return __real_calloc(c, n);
    if (n && c > (SIZE_MAX - CANARY_BYTES) / n) return NULL;
    size_t total = c * n;
    void *raw = __real_malloc(total + CANARY_BYTES);
    if (raw) memset(raw, 0, total);
    return track(raw, total, file, line);
}

static void do_free(void *p, const char *file, int line) {
    if (!p) return;
    if (reporting) { Block *b = untrack(p); __real_free(b ? b->ptr : p); if (b) __real_free(b); return; }
    Block *b = untrack(p);
    if (!b) { note("invalid-free", 0, file, line); return; } /* don't pass an unknown pointer to the real free */
    if (!canary_ok(b)) note("overflow", b->size, b->file, b->line);
    __real_free(b->ptr);
    __real_free(b);
}

static void *do_realloc(void *p, size_t n, const char *file, int line) {
    if (reporting) return __real_realloc(p, n);
    if (!p) return do_malloc(n, file, line);
    Block *b = untrack(p);
    if (!b) { note("invalid-realloc", n, file, line); return NULL; }
    if (!canary_ok(b)) note("overflow", b->size, b->file, b->line);
    void *fresh = do_malloc(n, file ? file : b->file, file ? line : b->line);
    if (!fresh) { /* realloc failure leaves the old block untouched */
        unsigned k = bucket(b->ptr); b->next = table[k]; table[k] = b;
        return NULL;
    }
    memcpy(fresh, b->ptr, b->size < n ? b->size : n);
    __real_free(b->ptr);
    __real_free(b);
    return fresh;
}

/* Entry points reached through the -include'd macros (with a source location)... */
void *lc_malloc_at(size_t n, const char *file, int line) { return do_malloc(n, file, line); }
void lc_free_at(void *p, const char *file, int line) { do_free(p, file, line); }
void *lc_tag(void *p, const char *file, int line) {
    if (p) for (Block *b = table[bucket(p)]; b; b = b->next) if (b->ptr == p) { b->file = file; b->line = line; break; }
    return p;
}
long lc_tag_line(long r, char **lineptr, const char *file, int line) {
    if (lineptr && *lineptr) lc_tag(*lineptr, file, line);
    return r;
}
void *lc_calloc_at(size_t c, size_t n, const char *file, int line) { return do_calloc(c, n, file, line); }
void *lc_realloc_at(void *p, size_t n, const char *file, int line) { return do_realloc(p, n, file, line); }

/* ...and through the linker's --wrap (function pointers, libc-internal calls such as strdup). */
void *__wrap_malloc(size_t n) { return do_malloc(n, NULL, 0); }
void *__wrap_calloc(size_t c, size_t n) { return do_calloc(c, n, NULL, 0); }
void *__wrap_realloc(void *p, size_t n) { return do_realloc(p, n, NULL, 0); }
void __wrap_free(void *p) { do_free(p, NULL, 0); }
