#include <stdio.h>
#include "learnc.h"

int main(void) {
    int start = get_int("Start: ");
    if (start < 0) {
        printf("Nothing to count.\n");
        return 0;
    }
    for (int i = start; i >= 0; i--) {
        printf("%d\n", i);
    }
    printf("Liftoff!\n");
    return 0;
}
