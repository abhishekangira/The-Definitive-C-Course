#include <stdio.h>
#include "learnc.h"

// Layout (16 bits): yyyyyyy mmmm ddddd, year counted from 1980.
unsigned pack_date(unsigned year, unsigned month, unsigned day) {
    return ((year - 1980) << 9) | (month << 5) | day;
}

unsigned year_of(unsigned d) {
    return ((d >> 9) & 0x7F) + 1980;
}

unsigned month_of(unsigned d) {
    return (d >> 5) & 0xF;
}

unsigned day_of(unsigned d) {
    return d & 0x1F;
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
