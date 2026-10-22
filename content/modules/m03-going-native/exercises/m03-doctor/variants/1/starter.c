#include <stdio.h>

int main(void) {
    char name[64];
    int count;
    if (scanf("%63s", name) != 1) {
        return 1;
    }
    printf("hello, %s\n", name);
    return 0;
}
