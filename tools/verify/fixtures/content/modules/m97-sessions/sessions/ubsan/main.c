#include <limits.h>
#include <stdio.h>

int main(void) {
    int big = INT_MAX;
    int next = big + 1;
    printf("done\n");
    return next == 0;
}
