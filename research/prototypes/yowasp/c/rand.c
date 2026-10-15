#include <stdio.h>
#include <stdlib.h>
int main(void) {
    printf("RAND_MAX=%d\nno-srand:", RAND_MAX);
    for (int i = 0; i < 5; i++) printf(" %d", rand());
    srand(42);
    printf("\nsrand(42):");
    for (int i = 0; i < 5; i++) printf(" %d", rand());
    srand(42);
    printf("\nsrand(42) dice:");
    for (int i = 0; i < 10; i++) printf(" %d", rand() % 6 + 1);
    printf("\n");
    return 0;
}
