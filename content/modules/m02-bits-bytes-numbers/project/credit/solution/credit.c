#include <stdio.h>
#include "learnc.h"

// Returns 1 when the digits of n pass the Luhn checksum, otherwise 0.
int luhn_ok(long long n) {
    int sum = 0;
    int position = 0;  // 0 is the last digit
    while (n > 0) {
        int digit = (int)(n % 10);
        if (position % 2 == 1) {
            digit *= 2;
            if (digit > 9) {
                digit -= 9;  // the sum of the two digits of a number from 10 to 18
            }
        }
        sum += digit;
        n /= 10;
        position++;
    }
    return sum % 10 == 0;
}

int main(void) {
    long long number;
    do {
        number = get_ll("Number: ");
    } while (number <= 0);

    int digits = 0;
    long long prefix = number;
    for (long long rest = number; rest > 0; rest /= 10) {
        digits++;
    }
    while (prefix >= 100) {
        prefix /= 10;
    }

    if (!luhn_ok(number)) {
        printf("INVALID\n");
    } else if (digits == 15 && (prefix == 34 || prefix == 37)) {
        printf("AMEX\n");
    } else if (digits == 16 && prefix >= 51 && prefix <= 55) {
        printf("MASTERCARD\n");
    } else if ((digits == 13 || digits == 16) && prefix / 10 == 4) {
        printf("VISA\n");
    } else {
        printf("INVALID\n");
    }
    return 0;
}
