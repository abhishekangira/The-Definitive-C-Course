#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include "learnc.h"

// Blend the foreground over the background. Both colours are 0xRRGGBB, alpha is 0 to 255.
uint32_t blend(uint32_t fg, uint32_t bg, unsigned alpha) {
    (void)fg; (void)bg; (void)alpha;
    return 0;  // TODO
}

// Reads "#RRGGBB" (the '#' is optional) and returns 0xRRGGBB.
static uint32_t parse_color(const char *text) {
    if (text[0] == '#') text++;
    return (uint32_t)strtoul(text, NULL, 16);
}

int main(void) {
    uint32_t fg = parse_color(get_line("Foreground: "));
    uint32_t bg = parse_color(get_line("Background: "));
    unsigned alpha = (unsigned)get_int("Alpha: ");
    printf("#%06X\n", (unsigned)blend(fg, bg, alpha));
    return 0;
}
