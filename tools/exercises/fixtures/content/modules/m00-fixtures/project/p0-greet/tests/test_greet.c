#include "check.h"

int main(void) {
    char buf[32];
    format_greeting(buf, sizeof buf, "Bob");
    CHECK_EQ_STR(buf, "Hello, Bob!", "format_greeting(\"Bob\") is \"Hello, Bob!\"");
    format_greeting(buf, 8, "Bartholomew");
    CHECK_EQ_STR(buf, "Hello, ", "a small buffer truncates safely");
    return 0;
}
