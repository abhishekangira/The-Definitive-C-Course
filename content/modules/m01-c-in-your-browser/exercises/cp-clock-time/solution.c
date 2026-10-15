#include <stdio.h>
#include "learnc.h"

int main(void) {
    int hour;
    do {
        hour = get_int("Hour: ");
    } while (hour < 0 || hour > 23);
    int minute;
    do {
        minute = get_int("Minute: ");
    } while (minute < 0 || minute > 59);
    printf("%02d:%02d\n", hour, minute);
    return 0;
}
