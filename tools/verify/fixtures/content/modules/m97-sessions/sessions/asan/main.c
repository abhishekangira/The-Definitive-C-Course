#include <stdio.h>

int main(void) {
    int a[4] = {0, 0, 0, 0};
    for (int i = 0; i <= 4; i++) a[i] = i; /* i == 4 writes past the end */
    printf("%d\n", a[0]);
    return 0;
}
