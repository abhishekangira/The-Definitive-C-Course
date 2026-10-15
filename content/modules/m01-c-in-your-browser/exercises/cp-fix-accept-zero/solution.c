#include <stdio.h>
#include "learnc.h"

int main(void) {
    int guests;
    do {
        guests = get_int("Guests: ");
    } while (guests < 1 || guests > 10);
    printf("Table for %d\n", guests);
    return 0;
}
