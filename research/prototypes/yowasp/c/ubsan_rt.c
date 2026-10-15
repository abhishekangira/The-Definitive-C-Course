/* Tiny UBSan runtime for wasm32-wasi: prints native-UBSan-style messages. Proof of concept. */
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
typedef struct { const char *file; uint32_t line, col; } Loc;
typedef struct { uint16_t kind, info; char name[1]; } Type;
typedef struct { Loc loc; const Type *type; } OverflowData;
typedef struct { Loc loc; const Type *lhs, *rhs; } ShiftData;
typedef struct { Loc loc; const Type *arr, *idx; } OOBData;
typedef struct { Loc loc; const Type *type; unsigned char log_align, kind; } MismatchData;
typedef struct { Loc loc; } PtrOverflowData;

static int bits(const Type *t) { return 1 << (t->info >> 1); }
static int is_signed(const Type *t) { return t->info & 1; }
static long long val(const Type *t, uintptr_t v) {
    int b = bits(t);
    if (b > (int)(8 * sizeof(uintptr_t))) return *(long long *)v;  /* wider than pointer: passed by reference */
    if (is_signed(t)) { if (b == 8) return (int8_t)v; if (b == 16) return (int16_t)v; return (int32_t)v; }
    return (long long)v;
}
static void head(const Loc *l) { fflush(stdout); fprintf(stderr, "%s:%u:%u: runtime error: ", l->file, l->line, l->col); }
static void arith(OverflowData *d, uintptr_t a, uintptr_t b, const char *op) {
    head(&d->loc);
    fprintf(stderr, "%s integer overflow: %lld %s %lld cannot be represented in type %s\n",
            is_signed(d->type) ? "signed" : "unsigned", val(d->type, a), op, val(d->type, b), d->type->name);
}
void __ubsan_handle_add_overflow(OverflowData *d, uintptr_t a, uintptr_t b) { arith(d, a, b, "+"); }
void __ubsan_handle_sub_overflow(OverflowData *d, uintptr_t a, uintptr_t b) { arith(d, a, b, "-"); }
void __ubsan_handle_mul_overflow(OverflowData *d, uintptr_t a, uintptr_t b) { arith(d, a, b, "*"); }
void __ubsan_handle_negate_overflow(OverflowData *d, uintptr_t a) {
    head(&d->loc); fprintf(stderr, "negation of %lld cannot be represented in type %s\n", val(d->type, a), d->type->name); }
void __ubsan_handle_divrem_overflow(OverflowData *d, uintptr_t a, uintptr_t b) {
    head(&d->loc);
    if (val(d->type, b) == 0) fprintf(stderr, "division by zero\n");
    else fprintf(stderr, "division of %lld by %lld cannot be represented in type %s\n", val(d->type, a), val(d->type, b), d->type->name);
}
void __ubsan_handle_shift_out_of_bounds(ShiftData *d, uintptr_t a, uintptr_t b) {
    head(&d->loc);
    long long rhs = val(d->rhs, b);
    if (rhs < 0 || rhs >= bits(d->lhs)) fprintf(stderr, "shift exponent %lld is too large for %d-bit type %s\n", rhs, bits(d->lhs), d->lhs->name);
    else fprintf(stderr, "left shift of %lld by %lld places cannot be represented in type %s\n", val(d->lhs, a), rhs, d->lhs->name);
}
void __ubsan_handle_out_of_bounds(OOBData *d, uintptr_t i) {
    head(&d->loc); fprintf(stderr, "index %lld out of bounds for type %s\n", val(d->idx, i), d->arr->name); }
void __ubsan_handle_type_mismatch_v1(MismatchData *d, uintptr_t p) {
    static const char *kinds[] = {"load of", "store to", "reference binding to", "member access within", "member call on", "constructor call on"};
    head(&d->loc);
    if (!p) fprintf(stderr, "%s null pointer of type %s\n", d->kind < 6 ? kinds[d->kind] : "access to", d->type->name);
    else fprintf(stderr, "%s misaligned address %p for type %s, which requires %u byte alignment\n", d->kind < 6 ? kinds[d->kind] : "access to", (void *)p, d->type->name, 1u << d->log_align);
}
void __ubsan_handle_pointer_overflow(PtrOverflowData *d, uintptr_t base, uintptr_t res) {
    head(&d->loc); fprintf(stderr, "pointer index expression with base %p overflowed to %p\n", (void *)base, (void *)res); }
