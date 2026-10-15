/* ubsan_rt.c - UndefinedBehaviorSanitizer runtime for the in-browser toolchain (wasm32-wasip1).
 *
 * @yowasp/clang ships no sanitizer runtimes. Guardrail mode compiles learner code with
 *   -fsanitize=undefined -fno-sanitize-recover=all
 * and links this file. Messages follow compiler-rt's wording so they read like native UBSan:
 *   main.c:7:41: runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'
 * With -fno-sanitize-recover the compiler calls the *_abort handlers, which print, flush and exit(1),
 * matching native behaviour (stop at the first error). Struct layouts mirror compiler-rt's ubsan_handlers.h.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef uintptr_t ValueHandle;

typedef struct { const char *file; uint32_t line, col; } SourceLocation;
typedef struct { uint16_t kind, info; char name[1]; } TypeDescriptor;   /* kind: 0 int, 1 float, 0xffff unknown */

typedef struct { SourceLocation loc; const TypeDescriptor *type; } OverflowData;
typedef struct { SourceLocation loc; const TypeDescriptor *lhs, *rhs; } ShiftOutOfBoundsData;
typedef struct { SourceLocation loc; const TypeDescriptor *array, *index; } OutOfBoundsData;
typedef struct { SourceLocation loc; const TypeDescriptor *type; unsigned char log_align, check_kind; } TypeMismatchData;
typedef struct { SourceLocation loc, assumption_loc; const TypeDescriptor *type; } AlignmentAssumptionData;
typedef struct { SourceLocation loc; const TypeDescriptor *type; } VLABoundData;
typedef struct { SourceLocation loc; const TypeDescriptor *from, *to; } FloatCastOverflowData;
typedef struct { SourceLocation loc; const TypeDescriptor *type; } InvalidValueData;
typedef struct { SourceLocation loc; unsigned char kind; } InvalidBuiltinData;
typedef struct { SourceLocation attr_loc; } NonNullReturnData;
typedef struct { SourceLocation loc, attr_loc; int arg_index; } NonNullArgData;
typedef struct { SourceLocation loc; } PointerOverflowData;
typedef struct { SourceLocation loc; } UnreachableData;
typedef struct { SourceLocation loc; const TypeDescriptor *type; } FunctionTypeMismatchData;
typedef struct { SourceLocation loc; const TypeDescriptor *from, *to; unsigned char kind; } ImplicitConversionData;

/* ---- value decoding ---- */

static unsigned type_bits(const TypeDescriptor *t) { return t->kind == 0 ? 1u << (t->info >> 1) : t->info; }
static int type_signed(const TypeDescriptor *t) { return t->kind == 0 && (t->info & 1); }
static int is_inline(unsigned bits) { return bits <= 8 * sizeof(ValueHandle); }

static long long sint_value(const TypeDescriptor *t, ValueHandle v) {
    unsigned b = type_bits(t);
    if (!is_inline(b)) return b == 64 ? *(const int64_t *)v : (long long)*(const int64_t *)v; /* 128-bit: low half */
    unsigned shift = 8 * sizeof(ValueHandle) - b;
    return (long long)((intptr_t)(v << shift) >> shift);
}
static unsigned long long uint_value(const TypeDescriptor *t, ValueHandle v) {
    unsigned b = type_bits(t);
    if (!is_inline(b)) return *(const uint64_t *)v;
    return (unsigned long long)v;
}
static long double float_value(const TypeDescriptor *t, ValueHandle v) {
    unsigned b = type_bits(t);
    if (is_inline(b)) { float f; uint32_t u = (uint32_t)v; memcpy(&f, &u, sizeof f); return f; }
    if (b == 64) return *(const double *)v;
    return *(const long double *)v;
}

/* Appends a value formatted like compiler-rt. */
static void put_value(const TypeDescriptor *t, ValueHandle v) {
    if (t->kind == 0) {
        if (type_bits(t) > 64) { fputs("<128-bit value>", stderr); return; }
        if (type_signed(t)) fprintf(stderr, "%lld", sint_value(t, v));
        else fprintf(stderr, "%llu", uint_value(t, v));
    } else if (t->kind == 1) {
        fprintf(stderr, "%Lg", float_value(t, v));
    } else {
        fputs("<unknown>", stderr);
    }
}
/* clang stores the name already quoted, e.g. 'int'. */
static void put_type(const TypeDescriptor *t) { fputs(t->name, stderr); }

/* ---- reporting ---- */

static const SourceLocation *last_loc;

static void begin(const SourceLocation *loc) {
    fflush(stdout); /* keep program output ordered before the report */
    last_loc = loc;
    fprintf(stderr, "%s:%u:%u: runtime error: ", loc->file ? loc->file : "<unknown>", loc->line, loc->col);
}
static void end_and_maybe_die(int fatal) {
    fputc('\n', stderr);
    if (!fatal) return;
    if (last_loc)
        fprintf(stderr, "SUMMARY: UndefinedBehaviorSanitizer: undefined-behavior %s:%u:%u\n",
                last_loc->file ? last_loc->file : "<unknown>", last_loc->line, last_loc->col);
    fflush(stderr);
    _Exit(1);
}

/* Each check has a recoverable handler and an _abort twin (called under -fno-sanitize-recover). */

/* ---- arithmetic ---- */

static void arith(OverflowData *d, ValueHandle a, ValueHandle b, const char *op, int fatal) {
    begin(&d->loc);
    fprintf(stderr, "%s integer overflow: ", type_signed(d->type) ? "signed" : "unsigned");
    put_value(d->type, a); fprintf(stderr, " %s ", op); put_value(d->type, b);
    fputs(" cannot be represented in type ", stderr); put_type(d->type);
    end_and_maybe_die(fatal);
}
void __ubsan_handle_add_overflow(OverflowData *d, ValueHandle a, ValueHandle b) { arith(d, a, b, "+", 0); }
void __ubsan_handle_add_overflow_abort(OverflowData *d, ValueHandle a, ValueHandle b) { arith(d, a, b, "+", 1); }
void __ubsan_handle_sub_overflow(OverflowData *d, ValueHandle a, ValueHandle b) { arith(d, a, b, "-", 0); }
void __ubsan_handle_sub_overflow_abort(OverflowData *d, ValueHandle a, ValueHandle b) { arith(d, a, b, "-", 1); }
void __ubsan_handle_mul_overflow(OverflowData *d, ValueHandle a, ValueHandle b) { arith(d, a, b, "*", 0); }
void __ubsan_handle_mul_overflow_abort(OverflowData *d, ValueHandle a, ValueHandle b) { arith(d, a, b, "*", 1); }

static void negate(OverflowData *d, ValueHandle a, int fatal) {
    begin(&d->loc);
    if (type_signed(d->type)) {
        fputs("negation of ", stderr); put_value(d->type, a);
        fputs(" cannot be represented in type ", stderr); put_type(d->type);
        fputs("; cast to an unsigned type to negate this value to itself", stderr);
    } else {
        fputs("negation of ", stderr); put_value(d->type, a);
        fputs(" cannot be represented in type ", stderr); put_type(d->type);
    }
    end_and_maybe_die(fatal);
}
void __ubsan_handle_negate_overflow(OverflowData *d, ValueHandle a) { negate(d, a, 0); }
void __ubsan_handle_negate_overflow_abort(OverflowData *d, ValueHandle a) { negate(d, a, 1); }

static void divrem(OverflowData *d, ValueHandle a, ValueHandle b, int fatal) {
    begin(&d->loc);
    int zero = d->type->kind == 0 ? (type_signed(d->type) ? sint_value(d->type, b) == 0 : uint_value(d->type, b) == 0)
                                  : float_value(d->type, b) == 0;
    if (zero) fputs("division by zero", stderr);
    else {
        fputs("division of ", stderr); put_value(d->type, a); fputs(" by ", stderr); put_value(d->type, b);
        fputs(" cannot be represented in type ", stderr); put_type(d->type);
    }
    end_and_maybe_die(fatal);
}
void __ubsan_handle_divrem_overflow(OverflowData *d, ValueHandle a, ValueHandle b) { divrem(d, a, b, 0); }
void __ubsan_handle_divrem_overflow_abort(OverflowData *d, ValueHandle a, ValueHandle b) { divrem(d, a, b, 1); }

static void shift(ShiftOutOfBoundsData *d, ValueHandle a, ValueHandle b, int fatal) {
    begin(&d->loc);
    int rhs_negative = type_signed(d->rhs) && sint_value(d->rhs, b) < 0;
    unsigned long long rhs = type_signed(d->rhs) ? (unsigned long long)sint_value(d->rhs, b) : uint_value(d->rhs, b);
    if (rhs_negative) {
        fputs("shift exponent ", stderr); put_value(d->rhs, b); fputs(" is negative", stderr);
    } else if (rhs >= type_bits(d->lhs)) {
        fputs("shift exponent ", stderr); put_value(d->rhs, b);
        fprintf(stderr, " is too large for %u-bit type ", type_bits(d->lhs)); put_type(d->lhs);
    } else if (type_signed(d->lhs) && sint_value(d->lhs, a) < 0) {
        fputs("left shift of negative value ", stderr); put_value(d->lhs, a);
    } else {
        fputs("left shift of ", stderr); put_value(d->lhs, a); fputs(" by ", stderr); put_value(d->rhs, b);
        fputs(" places cannot be represented in type ", stderr); put_type(d->lhs);
    }
    end_and_maybe_die(fatal);
}
void __ubsan_handle_shift_out_of_bounds(ShiftOutOfBoundsData *d, ValueHandle a, ValueHandle b) { shift(d, a, b, 0); }
void __ubsan_handle_shift_out_of_bounds_abort(ShiftOutOfBoundsData *d, ValueHandle a, ValueHandle b) { shift(d, a, b, 1); }

/* ---- memory and pointers ---- */

static void oob(OutOfBoundsData *d, ValueHandle i, int fatal) {
    begin(&d->loc);
    fputs("index ", stderr); put_value(d->index, i); fputs(" out of bounds for type ", stderr); put_type(d->array);
    end_and_maybe_die(fatal);
}
void __ubsan_handle_out_of_bounds(OutOfBoundsData *d, ValueHandle i) { oob(d, i, 0); }
void __ubsan_handle_out_of_bounds_abort(OutOfBoundsData *d, ValueHandle i) { oob(d, i, 1); }

static const char *const check_kinds[] = {
    "load of", "store to", "reference binding to", "member access within", "member call on",
    "constructor call on", "downcast of", "downcast of", "upcast of", "cast to virtual base of",
    "_Nonnull binding to", "dynamic operation on",
};

static void mismatch(TypeMismatchData *d, ValueHandle p, int fatal) {
    const char *kind = d->check_kind < sizeof check_kinds / sizeof *check_kinds ? check_kinds[d->check_kind] : "access to";
    uintptr_t align = (uintptr_t)1 << d->log_align;
    begin(&d->loc);
    if (!p) { fprintf(stderr, "%s null pointer of type ", kind); put_type(d->type); }
    else if (p & (align - 1)) {
        fprintf(stderr, "%s misaligned address %p for type ", kind, (void *)p); put_type(d->type);
        fprintf(stderr, ", which requires %lu byte alignment", (unsigned long)align);
    } else {
        fprintf(stderr, "%s address %p with insufficient space for an object of type ", kind, (void *)p); put_type(d->type);
    }
    end_and_maybe_die(fatal);
}
void __ubsan_handle_type_mismatch_v1(TypeMismatchData *d, ValueHandle p) { mismatch(d, p, 0); }
void __ubsan_handle_type_mismatch_v1_abort(TypeMismatchData *d, ValueHandle p) { mismatch(d, p, 1); }

static void ptr_overflow(PointerOverflowData *d, ValueHandle base, ValueHandle result, int fatal) {
    begin(&d->loc);
    if (!base && !result) fputs("applying zero offset to null pointer", stderr);
    else if (!base) fprintf(stderr, "applying non-zero offset %p to null pointer", (void *)result);
    else if (!result) fprintf(stderr, "applying non-zero offset to non-null pointer %p produced null pointer", (void *)base);
    else fprintf(stderr, "pointer index expression with base %p overflowed to %p", (void *)base, (void *)result);
    end_and_maybe_die(fatal);
}
void __ubsan_handle_pointer_overflow(PointerOverflowData *d, ValueHandle b, ValueHandle r) { ptr_overflow(d, b, r, 0); }
void __ubsan_handle_pointer_overflow_abort(PointerOverflowData *d, ValueHandle b, ValueHandle r) { ptr_overflow(d, b, r, 1); }

static void align_assume(AlignmentAssumptionData *d, ValueHandle p, ValueHandle align, ValueHandle offset, int fatal) {
    (void)p; (void)offset;
    begin(&d->loc);
    fprintf(stderr, "assumption of %lu byte alignment for pointer of type ", (unsigned long)align); put_type(d->type);
    fputs(" failed", stderr);
    end_and_maybe_die(fatal);
}
void __ubsan_handle_alignment_assumption(AlignmentAssumptionData *d, ValueHandle p, ValueHandle a, ValueHandle o) { align_assume(d, p, a, o, 0); }
void __ubsan_handle_alignment_assumption_abort(AlignmentAssumptionData *d, ValueHandle p, ValueHandle a, ValueHandle o) { align_assume(d, p, a, o, 1); }

/* ---- values ---- */

static void vla(VLABoundData *d, ValueHandle b, int fatal) {
    begin(&d->loc);
    fputs("variable length array bound evaluates to non-positive value ", stderr); put_value(d->type, b);
    end_and_maybe_die(fatal);
}
void __ubsan_handle_vla_bound_not_positive(VLABoundData *d, ValueHandle b) { vla(d, b, 0); }
void __ubsan_handle_vla_bound_not_positive_abort(VLABoundData *d, ValueHandle b) { vla(d, b, 1); }

static void float_cast(FloatCastOverflowData *d, ValueHandle v, int fatal) {
    begin(&d->loc);
    put_value(d->from, v); fputs(" is outside the range of representable values of type ", stderr); put_type(d->to);
    end_and_maybe_die(fatal);
}
void __ubsan_handle_float_cast_overflow(FloatCastOverflowData *d, ValueHandle v) { float_cast(d, v, 0); }
void __ubsan_handle_float_cast_overflow_abort(FloatCastOverflowData *d, ValueHandle v) { float_cast(d, v, 1); }

static void invalid_value(InvalidValueData *d, ValueHandle v, int fatal) {
    begin(&d->loc);
    fputs("load of value ", stderr); put_value(d->type, v);
    fputs(", which is not a valid value for type ", stderr); put_type(d->type);
    end_and_maybe_die(fatal);
}
void __ubsan_handle_load_invalid_value(InvalidValueData *d, ValueHandle v) { invalid_value(d, v, 0); }
void __ubsan_handle_load_invalid_value_abort(InvalidValueData *d, ValueHandle v) { invalid_value(d, v, 1); }

static void invalid_builtin(InvalidBuiltinData *d, int fatal) {
    begin(&d->loc);
    if (d->kind == 0) fputs("passing zero to __builtin_ctz(), which is not a valid argument", stderr);
    else if (d->kind == 1) fputs("passing zero to __builtin_clz(), which is not a valid argument", stderr);
    else fputs("assumption is violated during execution", stderr);
    end_and_maybe_die(fatal);
}
void __ubsan_handle_invalid_builtin(InvalidBuiltinData *d) { invalid_builtin(d, 0); }
void __ubsan_handle_invalid_builtin_abort(InvalidBuiltinData *d) { invalid_builtin(d, 1); }

static void implicit_conversion(ImplicitConversionData *d, ValueHandle src, ValueHandle dst, int fatal) {
    begin(&d->loc);
    fputs("implicit conversion from type ", stderr); put_type(d->from); fputs(" of value ", stderr); put_value(d->from, src);
    fputs(" to type ", stderr); put_type(d->to); fputs(" changed the value to ", stderr); put_value(d->to, dst);
    end_and_maybe_die(fatal);
}
void __ubsan_handle_implicit_conversion(ImplicitConversionData *d, ValueHandle s, ValueHandle t) { implicit_conversion(d, s, t, 0); }
void __ubsan_handle_implicit_conversion_abort(ImplicitConversionData *d, ValueHandle s, ValueHandle t) { implicit_conversion(d, s, t, 1); }

/* ---- attributes ---- */

static void nonnull_arg(NonNullArgData *d, int fatal) {
    begin(&d->loc);
    fprintf(stderr, "null pointer passed as argument %d, which is declared to never be null", d->arg_index);
    end_and_maybe_die(fatal);
}
void __ubsan_handle_nonnull_arg(NonNullArgData *d) { nonnull_arg(d, 0); }
void __ubsan_handle_nonnull_arg_abort(NonNullArgData *d) { nonnull_arg(d, 1); }
void __ubsan_handle_nullability_arg(NonNullArgData *d) { nonnull_arg(d, 0); }
void __ubsan_handle_nullability_arg_abort(NonNullArgData *d) { nonnull_arg(d, 1); }

static void nonnull_return(NonNullReturnData *d, SourceLocation *loc, int fatal) {
    (void)d;
    begin(loc);
    fputs("null pointer returned from function declared to never return null", stderr);
    end_and_maybe_die(fatal);
}
void __ubsan_handle_nonnull_return_v1(NonNullReturnData *d, SourceLocation *l) { nonnull_return(d, l, 0); }
void __ubsan_handle_nonnull_return_v1_abort(NonNullReturnData *d, SourceLocation *l) { nonnull_return(d, l, 1); }
void __ubsan_handle_nullability_return_v1(NonNullReturnData *d, SourceLocation *l) { nonnull_return(d, l, 0); }
void __ubsan_handle_nullability_return_v1_abort(NonNullReturnData *d, SourceLocation *l) { nonnull_return(d, l, 1); }

/* ---- control flow ---- */

static void function_mismatch(FunctionTypeMismatchData *d, ValueHandle f, int fatal) {
    begin(&d->loc);
    fprintf(stderr, "call to function %p through pointer to incorrect function type ", (void *)f); put_type(d->type);
    end_and_maybe_die(fatal);
}
void __ubsan_handle_function_type_mismatch(FunctionTypeMismatchData *d, ValueHandle f) { function_mismatch(d, f, 0); }
void __ubsan_handle_function_type_mismatch_abort(FunctionTypeMismatchData *d, ValueHandle f) { function_mismatch(d, f, 1); }

/* Always fatal: there is no sensible way to continue. */
void __ubsan_handle_builtin_unreachable(UnreachableData *d) {
    begin(&d->loc); fputs("execution reached an unreachable program point", stderr); end_and_maybe_die(1);
}
void __ubsan_handle_missing_return(UnreachableData *d) {
    begin(&d->loc); fputs("execution reached the end of a value-returning function without returning a value", stderr); end_and_maybe_die(1);
}
