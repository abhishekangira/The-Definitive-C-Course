#include <stdio.h>
#include "learnc.h"

// Layout (16 bits): rrrrr gggggg bbbbb.
unsigned pack565(unsigned r, unsigned g, unsigned b) {
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

unsigned red8(unsigned p) {
    return ((p >> 11) & 0x1F) << 3;
}

unsigned green8(unsigned p) {
    return ((p >> 5) & 0x3F) << 2;
}

unsigned blue8(unsigned p) {
    return (p & 0x1F) << 3;
}

int main(void) {
    unsigned r = (unsigned)get_int("Red: ");
    unsigned g = (unsigned)get_int("Green: ");
    unsigned b = (unsigned)get_int("Blue: ");
    unsigned p = pack565(r, g, b);
    printf("packed: 0x%04x\n", p);
    printf("red=%u green=%u blue=%u\n", red8(p), green8(p), blue8(p));
    return 0;
}
