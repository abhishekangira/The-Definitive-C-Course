#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    (void)argv;
    printf("about to exit (buffered, no newline)");
    if (argc > 5) return 3;
    exit(42);
}
