#include <stdio.h>

int main(void) {
    int n = 0, total = 0;
    while (scanf("%d", &n) == 1) {
        total += n;
    }
    printf("total = %d\n", total);
    return 0;
}
