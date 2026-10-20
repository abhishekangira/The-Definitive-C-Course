#include <limits.h>
#include <stdio.h>

int main(void) {
    int big = INT_MAX;
    int next = big + 1; /* signed overflow: undefined behaviour */
    printf("done\n");
    return next == 0;
}
