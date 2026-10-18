#include <stdint.h>
#include <stdio.h>
#include "learnc.h"

// Layout: 0xRRGGBBAA, red in the top byte.
uint32_t pack_rgba(unsigned r, unsigned g, unsigned b, unsigned a) {
    return ((uint32_t)r << 24) | ((uint32_t)g << 16) | ((uint32_t)b << 8) | (uint32_t)a;
}

unsigned red_of(uint32_t c) {
    return (c >> 24) & 0xFF;
}

unsigned green_of(uint32_t c) {
    return (c >> 16) & 0xFF;
}

unsigned blue_of(uint32_t c) {
    return (c >> 8) & 0xFF;
}

unsigned alpha_of(uint32_t c) {
    return (c >> 0) & 0xFF;
}

int main(void) {
    unsigned r = (unsigned)get_int("Red: ");
    unsigned g = (unsigned)get_int("Green: ");
    unsigned b = (unsigned)get_int("Blue: ");
    unsigned a = (unsigned)get_int("Alpha: ");
    uint32_t c = pack_rgba(r, g, b, a);
    printf("packed: 0x%08x\n", (unsigned)c);
    printf("red=%u green=%u blue=%u alpha=%u\n", red_of(c), green_of(c), blue_of(c), alpha_of(c));
    return 0;
}
