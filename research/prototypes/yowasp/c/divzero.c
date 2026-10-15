#include <stdio.h>
int main(int argc, char **argv) {
    (void)argv;
    int zero = argc - 1;
    printf("float 1.0/0 = %f\n", 1.0 / (double)zero);
    fflush(stdout);
    printf("int 1/0 = %d\n", 1 / zero);
    return 0;
}
