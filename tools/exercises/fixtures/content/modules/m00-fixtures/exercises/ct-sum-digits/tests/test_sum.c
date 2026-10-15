#include "check.h"
#include <limits.h>

int main(void) {
    CHECK_EQ_INT(sum_digits(1234), 10, "sum_digits(1234) is 10");
    CHECK_EQ_INT(sum_digits(7), 7, "sum_digits(7) is 7");
    CHECK_EQ_INT(sum_digits(-99), 18, "sum_digits(-99) is 18");
    CHECK_EQ_INT(sum_digits(INT_MIN), 47, "sum_digits(INT_MIN) is 47");
    return 0;
}
