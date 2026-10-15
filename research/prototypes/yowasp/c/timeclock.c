#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <time.h>
int main(void) {
    time_t t = time(NULL);
    printf("time(NULL) > 1.7e9: %d\n", t > 1700000000);
    struct timespec ts;
    printf("timespec_get=%d\n", timespec_get(&ts, TIME_UTC));
    printf("clock_gettime MONOTONIC=%d\n", clock_gettime(CLOCK_MONOTONIC, &ts));
    struct tm *tm = gmtime(&t);
    char buf[64];
    strftime(buf, sizeof buf, "%Y-%m-%d", tm);
    printf("year ok: %d\n", tm->tm_year + 1900 >= 2024);
    struct tm *lt = localtime(&t);
    printf("localtime tz offset hours vs gmt: %d\n", lt->tm_hour - tm->tm_hour);
    return 0;
}
