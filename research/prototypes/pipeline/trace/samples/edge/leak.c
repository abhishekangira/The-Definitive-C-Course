#include <stdlib.h>
#include <string.h>

int main(void) {
    char *s = malloc(6);
    strcpy(s, "hello");
    void *v = malloc(4);
    s = NULL;          /* leak: block #1 now unreferenced */
    free(v);
    return 0;
}
