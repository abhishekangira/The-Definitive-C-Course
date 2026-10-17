#include <stdio.h>
#include "learnc.h"

int main(void) {
    int count = get_int("Items: ");
    if (count < 1) {
        printf("none\n");
        return 0;
    }
    for (int i = count - 1; i >= 0; i--) {
        printf("%d\n", i);
    }
    return 0;
}
