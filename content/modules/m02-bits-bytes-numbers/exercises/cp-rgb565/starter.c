#include <stdio.h>
#include "learnc.h"

// Layout (16 bits): rrrrr gggggg bbbbb.
unsigned pack565(unsigned r, unsigned g, unsigned b) {
    (void)r; (void)g; (void)b;
    return 0;  // TODO
}

unsigned red8(unsigned p) {
    (void)p;
    return 0;  // TODO
}

unsigned green8(unsigned p) {
    (void)p;
    return 0;  // TODO
}

unsigned blue8(unsigned p) {
    (void)p;
    return 0;  // TODO
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
