#ifndef GREET_H
#define GREET_H
#include <stddef.h>

/* Writes "Hello, NAME!" into buf (at most size bytes, always '\0'-terminated). */
void format_greeting(char *buf, size_t size, const char *name);

#endif
