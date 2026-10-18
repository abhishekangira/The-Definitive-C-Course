#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include "learnc.h"

// Blend the foreground over the background. Both colours are 0xRRGGBB, alpha is 0 to 255.
static unsigned mix(unsigned f, unsigned b, unsigned alpha) {
    return (f * alpha + b * (255 - alpha) + 127) / 255;
}

uint32_t blend(uint32_t fg, uint32_t bg, unsigned alpha) {
    unsigned r = mix((fg >> 16) & 0xFF, (bg >> 16) & 0xFF, alpha);
    unsigned g = mix((fg >> 8) & 0xFF, (bg >> 8) & 0xFF, alpha);
    unsigned b = mix(fg & 0xFF, bg & 0xFF, alpha);
    return ((uint32_t)r << 16) | ((uint32_t)g << 8) | (uint32_t)b;
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
