#include <stdio.h>
#include <limits.h>
int main(int argc, char **argv) {
    (void)argv;
    int m = -argc; /* -1 */
    volatile int mn = INT_MIN;
    printf("INT_MIN / -1 = %d\n", mn / m);
    return 0;
}
