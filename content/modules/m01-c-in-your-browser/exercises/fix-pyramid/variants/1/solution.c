#include <stdio.h>
#include "learnc.h"

int main(void) {
    int n = get_int("n: ");
    for (int i = n; i >= 1; i--) {
        printf("%d\n", i);
    }
    printf("done\n");
    return 0;
}
