#include <stdio.h>
#include "learnc.h"

int main(void) {
    int n;
    do {
        n = get_int("Number: ");
    } while (n < 0);
    int ones = 0;
    while (n > 0) {
        ones += n & 1;
        n >>= 1;
    }
    printf("%d\n", ones);
    return 0;
}
