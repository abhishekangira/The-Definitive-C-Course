#include <stdio.h>
#include <stddef.h>
#include <stdint.h>
#include <stdalign.h>
#include <stdbool.h>
#include <wchar.h>
#include <time.h>
struct A { char c; int i; };
struct B { char c; double d; };
struct C { char c; long l; char d; };
struct D { char c; long double ld; };
struct E { int i; char c; };
struct F { char a; short b; char c; long long d; };
struct G { char *p; char c; };
union U { char c; double d; int i; };
struct Bits { unsigned a:3; unsigned b:5; unsigned c:30; };
struct FAM { int n; char data[]; };
#define S(T) printf("%-14s size=%2zu align=%2zu\n", #T, sizeof(T), alignof(T))
int main(void) {
    S(char); S(short); S(int); S(long); S(long long); S(void*); S(size_t); S(ptrdiff_t); S(intptr_t);
    S(float); S(double); S(long double); S(bool); S(wchar_t); S(time_t); S(max_align_t); S(intmax_t);
    S(struct A); S(struct B); S(struct C); S(struct D); S(struct E); S(struct F); S(struct G);
    S(union U); S(struct Bits); S(struct FAM);
    printf("offsetof C.l=%zu C.d=%zu F.d=%zu D.ld=%zu\n", offsetof(struct C, l), offsetof(struct C, d), offsetof(struct F, d), offsetof(struct D, ld));
    printf("char is %s\n", ((char)-1 < 0) ? "signed" : "unsigned");
    unsigned int one = 1;
    printf("endianness: %s\n", *(unsigned char *)&one ? "little" : "big");
    printf("sizeof('a')=%zu sizeof(1.0f)=%zu sizeof(\"hi\")=%zu\n", sizeof('a'), sizeof(1.0f), sizeof("hi"));
#ifdef __wasm__
    puts("__wasm__ defined");
#endif
#ifdef __wasi__
    puts("__wasi__ defined");
#endif
#ifdef __x86_64__
    puts("__x86_64__ defined");
#endif
#ifdef __STDC_NO_THREADS__
    puts("__STDC_NO_THREADS__ defined");
#endif
#ifdef __STDC_NO_ATOMICS__
    puts("__STDC_NO_ATOMICS__ defined");
#endif
#ifdef __STDC_NO_VLA__
    puts("__STDC_NO_VLA__ defined");
#endif
#ifdef __STDC_IEC_559__
    puts("__STDC_IEC_559__ defined");
#endif
    printf("__STDC_VERSION__=%ldL\n", __STDC_VERSION__);
    return 0;
}
