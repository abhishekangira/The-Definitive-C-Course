#include <stdio.h>
#include "learnc.h"

int main(void) {
    unsigned a = (unsigned)get_int("a: ");
    unsigned b = (unsigned)get_int("b: ");
    unsigned gap = a - b;
    if (gap < 0) {
        gap = b - a;
    }
    printf("Gap: %u\n", gap);
    return 0;
}
