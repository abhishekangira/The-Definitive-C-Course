#include <stdio.h>
#include "learnc.h"

int main(void) {
    int n;
    do {
        n = get_int("n: ");
    } while (n < 1 || n > 1000);
    int total = 0;
    for (int i = 1; i <= n; i++) {
        total += i;
    }
    printf("%d\n", total);
    return 0;
}
