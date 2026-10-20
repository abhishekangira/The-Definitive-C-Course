#include <stdio.h>

int area(int w, int h); /* declared, never defined */

int main(void) {
    printf("%d\n", area(3, 4));
    return 0;
}
