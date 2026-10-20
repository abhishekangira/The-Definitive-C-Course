#include "luhn.h"

int luhn_sum(long long n) {
    int sum = 0;
    for (int pos = 0; n > 0; pos++, n /= 10) {
        int d = (int)(n % 10);
        if (pos % 2) { d *= 2; if (d > 9) d -= 9; }
        sum += d;
    }
    return sum;
}
