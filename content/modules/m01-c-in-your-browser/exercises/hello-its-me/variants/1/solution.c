#include <stdio.h>
#include "learnc.h"

int main(void) {
    const char *name = get_line("Name? ");
    int age = get_int("Age? ");
    printf("%s, next year you'll be %d.\n", name, age + 1);
    return 0;
}
