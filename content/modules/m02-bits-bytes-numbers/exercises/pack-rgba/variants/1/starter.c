#include <stdio.h>
#include "learnc.h"

// Layout (16 bits): yyyyyyy mmmm ddddd, year counted from 1980.
unsigned pack_date(unsigned year, unsigned month, unsigned day) {
    (void)year; (void)month; (void)day;
    return 0;  // TODO
}

unsigned year_of(unsigned d) {
    (void)d;
    return 1980;  // TODO
}

unsigned month_of(unsigned d) {
    (void)d;
    return 0;  // TODO
}

unsigned day_of(unsigned d) {
    (void)d;
    return 0;  // TODO
}

int main(void) {
    unsigned year = (unsigned)get_int("Year: ");
    unsigned month = (unsigned)get_int("Month: ");
    unsigned day = (unsigned)get_int("Day: ");
    unsigned d = pack_date(year, month, day);
    printf("packed: 0x%04x\n", d);
    printf("%u-%u-%u\n", year_of(d), month_of(d), day_of(d));
    return 0;
}
