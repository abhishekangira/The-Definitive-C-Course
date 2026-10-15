#include <stdio.h>
int main(void) {
    for (int i = 10; i > 0; i -= 2) {
        printf("%d\n", i);
    }
    printf("Go!\n");
    return 0;
}
