#include <stdio.h>

static int divide(int a, int b) {
    return a / b;
}

int main(int argc, char **argv) {
    (void)argv;
    printf("about to divide\n");
    return divide(10, argc - 1);
}
