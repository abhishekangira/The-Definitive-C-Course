#include "check.h"
#include <stdint.h>

static uint8_t oracle(unsigned x) { return (uint8_t)((256 - x) % 256); }

int main(void) {
    long first_bad = -1;
    for (unsigned x = 0; x < 256; x++) {
        if (first_bad < 0 && negate((uint8_t)x) != oracle(x)) first_bad = (long)x;
    }
    CHECK_EQ_LL(first_bad, -1, "negate(x) is 256 - x, wrapped to 8 bits, for all 256 values (a wrong x is shown)");
    return 0;
}
