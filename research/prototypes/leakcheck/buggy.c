#include <stdio.h>
#include <stdlib.h>
#include <string.h>
char *str_dup(const char *s) {
    char *d = malloc(strlen(s));      /* BUG: forgot +1 for the NUL */
    strcpy(d, s);
    return d;
}
int main(void) {
    char *a = str_dup("hello");
    char *b = str_dup("world");
    printf("%s %s\n", a, b);
    free(a);                          /* b is leaked */
    return 0;
}
