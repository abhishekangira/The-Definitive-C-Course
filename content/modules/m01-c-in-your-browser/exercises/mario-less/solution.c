#include <stdio.h>
#include "learnc.h"

int main(void) {
    int height;
    do {
        height = get_int("Height: ");
    } while (height < 1 || height > 8);

    for (int row = 1; row <= height; row++) {
        for (int s = 0; s < height - row; s++) {
            printf(" ");
        }
        for (int h = 0; h < row; h++) {
            printf("#");
        }
        printf("\n");
    }
    return 0;
}
