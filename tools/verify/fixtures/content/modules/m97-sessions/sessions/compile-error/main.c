#include <stdio.h>

int main(void) {
    int n = 5;
    n.digits = 1; /* n is an int, not a struct */
    printf("%d\n", n);
    return 0;
}
