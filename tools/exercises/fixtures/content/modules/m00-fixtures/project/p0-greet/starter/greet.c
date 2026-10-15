#include <stdio.h>
#include "greet.h"

void format_greeting(char *buf, size_t size, const char *name) {
    snprintf(buf, size, "Hello, %s", name);
}
