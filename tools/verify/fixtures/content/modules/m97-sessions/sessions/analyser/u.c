#include <stdio.h>

static void add_digit(int *sum, int d) { *sum += d; }

int main(void) {
    int sum;
    for (int d = 1; d <= 3; d++) add_digit(&sum, d);
    if (sum == 123456789) puts("lucky");
    return 0;
}
