#include <stdio.h>
#include "learnc.h"

int max3(int a, int b, int c) {
    int best = a;
    if (b > best) {
        best = b;
    }
    if (c > best) {
        best = c;
    }
    return best;
}

int main(void) {
    int a = get_int("a: ");
    int b = get_int("b: ");
    int c = get_int("c: ");
    printf("max: %d\n", max3(a, b, c));
    return 0;
}
