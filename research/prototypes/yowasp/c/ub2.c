#include <stdio.h>
#include <limits.h>
struct P { int x; };
int main(int argc, char **argv) {
    (void)argv;
    int big = INT_MAX - 1 + argc;
    printf("signed overflow: %d\n", big + 1);
    int sh = 31 + argc;
    printf("shift by 32: %d\n", 1 << sh);
    int arr[4] = {1,2,3,4};
    int idx = 3 + argc;
    printf("arr[4] = %d\n", arr[idx]);
    long long ll = LLONG_MAX - 1 + argc;
    printf("ll+1 = %lld\n", ll + 1);
    int zero = argc - 1;
    struct P *p = (struct P *)(long)zero;
    printf("p->x = %d\n", p->x);
    printf("10/zero = %d\n", 10 / zero);
    return 0;
}
