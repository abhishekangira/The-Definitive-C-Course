#include <stdint.h>
#include <stdio.h>
#include "learnc.h"

// Layout: 0xRRGGBBAA, red in the top byte.
uint32_t pack_rgba(unsigned r, unsigned g, unsigned b, unsigned a) {
    (void)r; (void)g; (void)b; (void)a;
    return 0;  // TODO
}

unsigned red_of(uint32_t c) {
    (void)c;
    return 0;  // TODO
}

unsigned green_of(uint32_t c) {
    (void)c;
    return 0;  // TODO
}

unsigned blue_of(uint32_t c) {
    (void)c;
    return 0;  // TODO
}

unsigned alpha_of(uint32_t c) {
    (void)c;
    return 0;  // TODO
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
