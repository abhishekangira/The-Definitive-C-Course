#include "check.h"
#include <stdint.h>

static uint8_t oracle(unsigned x, unsigned y) { return (uint8_t)(x ^ y); }

int main(void) {
    long first_bad = -1;
    for (unsigned x = 0; x < 256; x++) {
        for (unsigned y = 0; y < 256; y++) {
            if (first_bad < 0 && bit_xor((uint8_t)x, (uint8_t)y) != oracle(x, y)) first_bad = (long)(x * 256 + y);
        }
    }
    CHECK_EQ_LL(first_bad, -1, "bit_xor(x, y) equals x ^ y for all 65536 pairs (a wrong pair is shown as x * 256 + y)");
    return 0;
}
