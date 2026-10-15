#include <stdio.h>
int depth = 0;
int recurse(int n) {
    volatile char pad[256];
    pad[0] = (char)n;
    depth++;
    return recurse(n + 1) + pad[0];
}
int main(void) { printf("start\n"); fflush(stdout); return recurse(0); }
