#include <stdio.h>
#include "learnc.h"

int main(void) {
    int height;
    do {
        height = get_int("Height: ");
    } while (height < 1 || height > 5);
    for (int row = height; row >= 1; row--) {
        for (int h = 0; h < row; h++) {
            printf("#");
        }
        printf("\n");
    }
    return 0;
}
