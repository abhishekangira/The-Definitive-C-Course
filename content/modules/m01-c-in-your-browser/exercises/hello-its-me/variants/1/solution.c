#include <stdio.h>
#include "learnc.h"

int main(void) {
    int age = get_int("Age? ");
    const char *name = get_line("Name? ");
    printf("%s, next year you'll be %d.\n", name, age + 1);
    return 0;
}
