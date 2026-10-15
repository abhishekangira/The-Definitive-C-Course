#include <stdio.h>

int count_digits(int n) {
    long long m = n < 0 ? -(long long)n : n;
    int count = 1;
    while (m >= 10) {
        count++;
        m /= 10;
    }
    return count;
}

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) {
        return 1;
    }
    printf("digits: %d\n", count_digits(n));
    return 0;
}
