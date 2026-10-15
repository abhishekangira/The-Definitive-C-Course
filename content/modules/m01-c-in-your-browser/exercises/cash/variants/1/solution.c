#include <stdio.h>
#include "learnc.h"

int main(void) {
    int cents;
    do {
        cents = get_int("Change owed: ");
    } while (cents <= 0);
    int coins = 0;
    coins += cents / 50; cents %= 50;
    coins += cents / 20; cents %= 20;
    coins += cents / 10; cents %= 10;
    coins += cents / 5;  cents %= 5;
    coins += cents / 2;  cents %= 2;
    coins += cents;
    printf("%d\n", coins);
    return 0;
}
