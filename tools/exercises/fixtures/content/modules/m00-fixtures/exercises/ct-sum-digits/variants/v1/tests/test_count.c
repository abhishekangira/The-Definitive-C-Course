#include "check.h"
#include <limits.h>

int main(void) {
    CHECK_EQ_INT(count_digits(5), 1, "count_digits(5) is 1");
    CHECK_EQ_INT(count_digits(-120), 3, "count_digits(-120) is 3");
    CHECK_EQ_INT(count_digits(INT_MIN), 10, "count_digits(INT_MIN) is 10");
    return 0;
}
