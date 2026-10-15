#include <stdio.h>

int f(int n) {
    if (n > 0) return 1;
}

int main(void) {
    int unused = 3;
    long big = 1234567890123L;
    unsigned u = 1;
    int i = -1;
    int uninit;
    printf("%d\n", big);
    if (i < u) puts("lt");
    char c = 300;
    printf("%d %d %d\n", f(1), c, uninit);
    return 0;
}
