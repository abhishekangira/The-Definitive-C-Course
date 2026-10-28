#include <stdio.h>

int square(int x) {
    return x * x;
}

int main(void) {
    int n = 5;
    int sq = square(n);
    printf("%d squared is %d\n", n, sq);
    return 0;
}
