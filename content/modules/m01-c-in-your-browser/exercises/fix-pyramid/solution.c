#include <stdio.h>
#include "learnc.h"

int main(void) {
    int height = get_int("Height: ");
    for (int row = 1; row <= height; row++) {
        for (int i = 0; i < row; i++) {
            printf("#");
        }
        printf("\n");
    }
    return 0;
}
