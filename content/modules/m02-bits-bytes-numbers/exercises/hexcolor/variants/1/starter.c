#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include "learnc.h"

// Each channel divided by 2 (rounded down). One shift and one mask on the whole colour.
uint32_t half(uint32_t c) {
    (void)c;
    return 0;  // TODO
}

// Each channel becomes 255 minus itself.
uint32_t invert(uint32_t c) {
    (void)c;
    return 0;  // TODO
}

// Reads "#RRGGBB" (the '#' is optional) and returns 0xRRGGBB.
static uint32_t parse_color(const char *text) {
    if (text[0] == '#') text++;
    return (uint32_t)strtoul(text, NULL, 16);
}

int main(void) {
    uint32_t c = parse_color(get_line("Colour: "));
    printf("half:   #%06X\n", (unsigned)half(c));
    printf("invert: #%06X\n", (unsigned)invert(c));
    return 0;
}
