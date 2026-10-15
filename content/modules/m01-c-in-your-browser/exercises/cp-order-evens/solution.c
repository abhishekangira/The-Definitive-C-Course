#include <stdio.h>
#include "learnc.h"
int main(void) {
    int n = get_int("n: ");
    int count = 0;
    for (int i = 1; i <= n; i++) {
        if (i % 2 == 0) {
            count++;
        }
    }
    printf("%d\n", count);
    return 0;
}
