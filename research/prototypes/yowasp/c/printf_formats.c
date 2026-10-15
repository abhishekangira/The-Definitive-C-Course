#include <stdio.h>
#include <stddef.h>
#include <stdint.h>
#include <inttypes.h>
#include <limits.h>
#include <float.h>

int main(void) {
    int x = 42;
    size_t sz = sizeof(long double);
    ptrdiff_t pd = -7;
    printf("d=%d i=%i u=%u x=%x X=%X o=%o c=%c s=%s %%\n", -5, 6, 3000000000u, 255, 255, 8, 'A', "str");
    printf("width:[%5d][%-5d][%05d][%+d][% d]\n", 42, 42, 42, 42, 42);
    printf("zu=%zu zd=%td ld=%ld lld=%lld lu=%lu hhd=%hhd hd=%hd\n", sz, pd, -123456789L, -1234567890123LL, 123456789UL, (signed char)200, (short)70000);
    printf("jd=%jd PRId64=%" PRId64 " PRIu32=%" PRIu32 " PRIxPTR=%" PRIxPTR "\n", (intmax_t)-1, (int64_t)INT64_MIN, (uint32_t)UINT32_MAX, (uintptr_t)0xbeef);
    printf("f=%f .3f=%.3f e=%e E=%E g=%g G=%G a=%a A=%A\n", 3.14159265358979, 2.0/3.0, 12345.678, 0.000123, 0.0001, 1e20, 1.0, 0.1);
    printf("0.1=%.20f 1/3f=%.10f inf=%f nan=%f -0=%f\n", 0.1, 1.0f/3.0f, 1.0/0.0, 0.0/0.0, -0.0);
    printf("big=%.0f FLT_MAX=%e DBL_MAX=%g DBL_MIN=%g FLT_EPS=%g DBL_EPS=%g\n", 1e22, FLT_MAX, DBL_MAX, DBL_MIN, FLT_EPSILON, DBL_EPSILON);
    printf("INT_MAX=%d INT_MIN=%d UINT_MAX=%u\n", INT_MAX, INT_MIN, UINT_MAX);
    printf("LONG_MAX=%ld LONG_MIN=%ld ULONG_MAX=%lu\n", LONG_MAX, LONG_MIN, ULONG_MAX);
    printf("LLONG_MAX=%lld SIZE_MAX=%zu PTRDIFF_MAX=%td\n", LLONG_MAX, SIZE_MAX, PTRDIFF_MAX);
    printf("CHAR_BIT=%d CHAR_MIN=%d CHAR_MAX=%d (char signed? %d)\n", CHAR_BIT, CHAR_MIN, CHAR_MAX, (char)-1 < 0);
    printf("LDBL_DIG=%d LDBL_MANT_DIG=%d DBL_MANT_DIG=%d FLT_EVAL_METHOD=%d\n", LDBL_DIG, LDBL_MANT_DIG, DBL_MANT_DIG, FLT_EVAL_METHOD);
    long double ld = 1.0L / 3.0L;
    printf("Lf=%.25Lf Le=%Le\n", ld, ld);
    printf("p=%p null=%p\n", (void*)&x, (void*)0);
    int n = 0;
    printf("count%n|\n", &n);
    printf("n=%d\n", n);
    printf("str prec=[%.3s] [%10s] [%-10s]\n", "abcdef", "hi", "hi");
    return 0;
}
