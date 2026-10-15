#include <stdio.h>

int sum_digits(int n) {
    long long m = n < 0 ? -(long long)n : n;
    int sum = 0;
    while (m > 0) {
        sum += (int)(m % 10);
        m /= 10;
    }
    return sum;
}

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) {
        return 1;
    }
    printf("sum: %d\n", sum_digits(n));
    return 0;
}
