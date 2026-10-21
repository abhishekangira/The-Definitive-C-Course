#include <math.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    double x = argc > 1 ? strtod(argv[1], NULL) : 2.0; /* a runtime value, so the call is not folded */
    printf("%.3f\n", sqrt(x));
    return 0;
}
