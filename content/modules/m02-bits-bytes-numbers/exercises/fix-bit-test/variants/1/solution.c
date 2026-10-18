#include <stdio.h>
#include "learnc.h"

int main(void) {
    int flags = get_int("Flags: ");
    int n = get_int("Bit: ");
    flags = flags & ~(1 << n);
    printf("%d\n", flags);
    return 0;
}
