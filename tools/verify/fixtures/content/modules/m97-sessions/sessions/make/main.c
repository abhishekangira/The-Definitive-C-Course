#include <stdio.h>
#include "luhn.h"

int main(void) {
    printf("%d\n", luhn_sum(4003600000000014LL));
    return 0;
}
