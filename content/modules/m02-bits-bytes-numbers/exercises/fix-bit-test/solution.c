#include <stdio.h>
#include "learnc.h"

int main(void) {
    int flags = get_int("Flags: ");
    int n = get_int("Bit: ");
    int on = (flags >> n) & 1;
    if (on) {
        printf("on\n");
    } else {
        printf("off\n");
    }
    return 0;
}
