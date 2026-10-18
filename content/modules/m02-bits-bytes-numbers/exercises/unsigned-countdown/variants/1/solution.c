#include <stdio.h>
#include "learnc.h"

int main(void) {
    unsigned a = (unsigned)get_int("a: ");
    unsigned b = (unsigned)get_int("b: ");
    unsigned gap;
    if (a >= b) {
        gap = a - b;
    } else {
        gap = b - a;
    }
    printf("Gap: %u\n", gap);
    return 0;
}
