#include <stdio.h>
#include <stdlib.h>
static int helper(void) { volatile int junk[8] = {11,22,33,44,55,66,77,88}; return junk[3]; }
static int reader(void) { volatile int x; return x; }
int main(void) {
    int a;
    printf("uninit local a=%d\n", a);
    helper();
    printf("uninit after helper: %d\n", reader());
    int *m = malloc(4 * sizeof(int));
    printf("fresh malloc: %d %d %d %d\n", m[0], m[1], m[2], m[3]);
    for (int i = 0; i < 4; i++) m[i] = 0x55;
    free(m);
    int *m2 = malloc(4 * sizeof(int));
    printf("reused malloc: %d %d %d %d (same ptr? %d)\n", m2[0], m2[1], m2[2], m2[3], m == m2);
    return 0;
}
