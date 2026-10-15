#include <stdio.h>
#include <stdint.h>
static int depth;
static uintptr_t first;
int recurse(int n) {
    volatile char pad[256];
    pad[0] = (char)n;
    if (!first) first = (uintptr_t)&pad[0];
    depth++;
    if (depth % 50 == 0) { printf("depth=%d used~%lu bytes\n", depth, (unsigned long)(first - (uintptr_t)&pad[0])); fflush(stdout); }
    return recurse(n + 1) + pad[0];
}
extern unsigned char __heap_base, __data_end, __global_base;
int main(void) {
#ifdef __wasm__
    int local;
    printf("&local=%p __data_end=%p __heap_base=%p __global_base=%p\n", (void*)&local, (void*)&__data_end, (void*)&__heap_base, (void*)&__global_base);
#endif
    return recurse(0);
}
