#include <stdio.h>
#include "learnc.h"

int max3(int a, int b, int c) {
    // TODO: return the largest of a, b and c
    (void)b;
    (void)c;
    return a;
}

int main(void) {
    int a = get_int("a: ");
    int b = get_int("b: ");
    int c = get_int("c: ");
    printf("max: %d\n", max3(a, b, c));
    return 0;
}
