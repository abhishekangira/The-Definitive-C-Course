#include <stdlib.h>

int main(void) {
    int *p = malloc(10 * sizeof *p); /* never freed */
    p[0] = 1;
    return p[0] - 1;
}
