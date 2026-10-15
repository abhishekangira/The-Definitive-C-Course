#include <stdio.h>
#include "learnc.h"

void print_row(int spaces, int bricks);

int main(void) {
    int height;
    do {
        height = get_int("Height: ");
    } while (height < 1 || height > 8);

    for (int row = 1; row <= height; row++) {
        print_row(height - row, row);
    }
    return 0;
}

// One row: left padding, left bricks, a two-space gap, right bricks (no trailing spaces).
void print_row(int spaces, int bricks) {
    for (int i = 0; i < spaces; i++) {
        printf(" ");
    }
    for (int i = 0; i < bricks; i++) {
        printf("#");
    }
    printf("  ");
    for (int i = 0; i < bricks; i++) {
        printf("#");
    }
    printf("\n");
}
