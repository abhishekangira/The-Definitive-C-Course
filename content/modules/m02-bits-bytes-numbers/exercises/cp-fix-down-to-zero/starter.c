#include <stdio.h>
#include "learnc.h"

int main(void) {
    int count = get_int("Items: ");
    if (count < 1) {
        printf("none\n");
        return 0;
    }
    for (unsigned i = (unsigned)(count - 1); i >= 0; i--) {
        printf("%u\n", i);
    }
    return 0;
}
