#include <stdio.h>
#include "learnc.h"

int main(void) {
    const char *name = get_line("What's your name? ");
    printf("hello, %s\n", name);
    return 0;
}
