#include <stdio.h>
#include <time.h>
int main(void) {
    clock_t c0 = clock();
    volatile double x = 0; for (long i = 0; i < 20000000; i++) x += i;
    clock_t c1 = clock();
    printf("CLOCKS_PER_SEC=%ld clock advanced: %d\n", (long)CLOCKS_PER_SEC, c1 > c0);
    return 0;
}
