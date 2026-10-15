#include <stdio.h>
#include "greet.h"

int main(void) {
    char name[64];
    if (scanf("%63s", name) != 1) {
        return 1;
    }
    char line[96];
    format_greeting(line, sizeof line, name);
    puts(line);
    return 0;
}
