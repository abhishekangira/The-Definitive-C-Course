#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int total;
    int arr[3];
    arr[0] = 5;
    int *buf = malloc(3 * sizeof *buf);
    buf[1] = 9;
    total = arr[0] + buf[1];
    free(buf);
    printf("%d\n", buf[1]);
    printf("%d\n", total);
    return 0;
}
