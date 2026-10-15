/* learnc.h - small input helpers for The Definitive C Course (MIT License).
 *
 * Header-only: just #include "learnc.h". Every function is static inline, so unused helpers
 * never trigger warnings under -Wall -Wextra.
 *
 *   int         get_int(const char *prompt);     re-prompts until the line is a whole int
 *   long long   get_ll(const char *prompt);      ...a whole long long
 *   double      get_double(const char *prompt);  ...a finite number
 *   const char *get_line(const char *prompt);    one line without its '\n' (may be empty)
 *
 * get_line returns a pointer to a static buffer that the next call overwrites, so copy what you
 * want to keep. Lines longer than LEARNC_LINE_MAX - 1 characters are truncated. On end of input
 * (Ctrl-D, or a test that supplies no more input) every function prints a message and exits with
 * status 1.
 *
 * Deterministic random numbers (the same sequence on every platform, unlike rand()):
 *   void     learnc_seed(uint32_t seed);
 *   uint32_t learnc_rand(void);                  0 .. 2^32-1
 *   int      learnc_rand_range(int lo, int hi);  lo .. hi inclusive
 */
#ifndef LEARNC_H
#define LEARNC_H

#include <errno.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef LEARNC_LINE_MAX
#define LEARNC_LINE_MAX 4096
#endif

/* Reads one line into a static buffer; NULL at end of input. Discards the rest of an over-long line. */
static inline const char *learnc_read_line(const char *prompt) {
    static char buf[LEARNC_LINE_MAX];
    if (prompt) { fputs(prompt, stdout); fflush(stdout); }
    if (!fgets(buf, sizeof buf, stdin)) return NULL;
    size_t len = strlen(buf);
    if (len > 0 && buf[len - 1] == '\n') buf[--len] = '\0';
    else { int c; while ((c = getchar()) != '\n' && c != EOF) {} }
    if (len > 0 && buf[len - 1] == '\r') buf[--len] = '\0';
    return buf;
}

static inline void learnc_eof(void) {
    fputs("\n(end of input)\n", stderr);
    exit(1);
}

static inline int learnc_only_space(const char *s) {
    while (*s == ' ' || *s == '\t') s++;
    return *s == '\0';
}

static inline const char *get_line(const char *prompt) {
    const char *line = learnc_read_line(prompt);
    if (!line) learnc_eof();
    return line;
}

static inline long long get_ll(const char *prompt) {
    for (;;) {
        const char *line = learnc_read_line(prompt);
        if (!line) learnc_eof();
        char *end;
        errno = 0;
        long long v = strtoll(line, &end, 10);
        if (end != line && errno == 0 && learnc_only_space(end) && !learnc_only_space(line)) return v;
    }
}

static inline int get_int(const char *prompt) {
    for (;;) {
        long long v = get_ll(prompt);
        if (v >= INT_MIN && v <= INT_MAX) return (int)v;
    }
}

static inline double get_double(const char *prompt) {
    for (;;) {
        const char *line = learnc_read_line(prompt);
        if (!line) learnc_eof();
        char *end;
        errno = 0;
        double v = strtod(line, &end);
        if (end != line && errno == 0 && learnc_only_space(end) && isfinite(v)) return v;
    }
}

/* PCG32 (O'Neill), fixed increment: identical output on every platform. */
static uint64_t learnc_rng_state = 0x853c49e6748fea9bULL;

static inline uint32_t learnc_rand(void) {
    uint64_t old = learnc_rng_state;
    learnc_rng_state = old * 6364136223846793005ULL + 1442695040888963407ULL;
    uint32_t xorshifted = (uint32_t)(((old >> 18u) ^ old) >> 27u);
    uint32_t rot = (uint32_t)(old >> 59u);
    return (xorshifted >> rot) | (xorshifted << ((-rot) & 31u));
}

static inline void learnc_seed(uint32_t seed) {
    learnc_rng_state = 0;
    (void)learnc_rand();
    learnc_rng_state += seed;
    (void)learnc_rand();
}

static inline int learnc_rand_range(int lo, int hi) {
    uint32_t span = (uint32_t)((int64_t)hi - lo + 1);
    return lo + (int)(span ? learnc_rand() % span : learnc_rand());
}

#endif /* LEARNC_H */
