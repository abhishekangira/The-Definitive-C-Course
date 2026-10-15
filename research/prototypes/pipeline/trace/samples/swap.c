#include <stdio.h>

void swap(int *a, int *b) {
    int tmp = *a;
    *a = *b;
    *b = tmp;
}

int main(void) {
    int x = 1;
    int y = 2;
    printf("before: x=%d y=%d\n", x, y);
    swap(&x, &y);
    printf("after: x=%d y=%d\n", x, y);
    return 0;
}
