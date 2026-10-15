#include <stdio.h>
#include <stddef.h>
struct S { int a; int b[100]; };
int main(void) {
    int *p = NULL;
    printf("reading *NULL...\n"); fflush(stdout);
    printf("*NULL = %d\n", *p);
    *p = 1234;
    printf("wrote *NULL=1234, read back %d\n", *p);
    struct S *s = NULL;
    printf("s->b[50] = %d\n", s->b[50]);
    void (*fp)(void) = NULL;
    printf("calling NULL function pointer...\n"); fflush(stdout);
    fp();
    printf("survived\n");
    return 0;
}
