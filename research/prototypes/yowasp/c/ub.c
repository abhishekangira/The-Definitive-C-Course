#include <stdio.h>
#include <limits.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    (void)argv;
    int big = INT_MAX - 1 + argc; /* INT_MAX */
    printf("signed overflow: %d\n", big + 1);
    fflush(stdout);
    int sh = 31 + argc;
    printf("shift by 32: %d\n", 1 << sh);
    fflush(stdout);
    int arr[4] = {1,2,3,4};
    int idx = 3 + argc;
    printf("arr[4] = %d\n", arr[idx]);
    return 0;
}
