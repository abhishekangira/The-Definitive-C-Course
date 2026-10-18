#include "check.h"
#include <stdint.h>

static int oracle(unsigned x) {
    for (unsigned p = 1; p <= 32768; p *= 2) {
        if (x == p) return 1;
    }
    return 0;
}

int main(void) {
    long first_bad = -1;
    for (unsigned x = 0; x < 65536; x++) {
        if (first_bad < 0 && is_pow2((uint16_t)x) != oracle(x)) first_bad = (long)x;
    }
    CHECK_EQ_LL(first_bad, -1, "is_pow2(x) is 1 exactly for 1, 2, 4, ... 32768, for all 65536 values (a wrong x is shown)");
    return 0;
}
