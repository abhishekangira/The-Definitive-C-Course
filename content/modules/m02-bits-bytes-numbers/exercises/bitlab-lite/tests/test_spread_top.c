#include "check.h"
#include <stdint.h>

static uint8_t oracle(unsigned x) { return x >= 128 ? 255 : 0; }

int main(void) {
    long first_bad = -1;
    for (unsigned x = 0; x < 256; x++) {
        if (first_bad < 0 && spread_top((uint8_t)x) != oracle(x)) first_bad = (long)x;
    }
    CHECK_EQ_LL(first_bad, -1, "spread_top(x) is 255 when the top bit is set and 0 otherwise, for all 256 values (a wrong x is shown)");
    return 0;
}
