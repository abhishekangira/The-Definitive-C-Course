#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
int main(void) {
    double *d = malloc(4 * sizeof *d);
    printf("aligned16=%d\n", (int)((uintptr_t)d % 16 == 0));
    d = realloc(d, 8 * sizeof *d);
    free(d);
    free(d);                         /* double free */
    int *g = calloc(3, sizeof *g);   /* leaked */
    g[0] = 1;
    return 0;
}
