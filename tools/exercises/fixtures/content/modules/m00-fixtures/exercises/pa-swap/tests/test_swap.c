#include "check.h"

int main(void) {
    int a = 5, b = -7;
    swap(&a, &b);
    CHECK_EQ_INT(a, -7, "swap(&a, &b) puts b's value in a");
    CHECK_EQ_INT(b, 5, "swap(&a, &b) puts a's value in b");
    return 0;
}
