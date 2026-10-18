#include "check.h"
#include <stdint.h>

static uint8_t oracle(unsigned x, unsigned n) { return n == 0 ? (uint8_t)(x % 256) : (uint8_t)(x / 256); }

int main(void) {
    long first_bad = -1;
    for (unsigned x = 0; x < 65536; x++) {
        for (unsigned n = 0; n < 2; n++) {
            if (first_bad < 0 && byte_of((uint16_t)x, (uint8_t)n) != oracle(x, n)) first_bad = (long)(x * 2 + n);
        }
    }
    CHECK_EQ_LL(first_bad, -1, "byte_of(x, n) is byte n of x for all 131072 inputs (a wrong input is shown as x * 2 + n)");
    return 0;
}
