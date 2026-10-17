#include <stdint.h>
#include <stdio.h>

/* Puzzle 1: x & y, using only ~ and |. */
uint8_t bit_and(uint8_t x, uint8_t y) {
    return ~(~x | ~y);
}

/* Puzzle 2: x ^ y, using only ~ and &. */
uint8_t bit_xor(uint8_t x, uint8_t y) {
    return ~(x & y) & ~(~x & ~y);
}

/* Puzzle 3: byte number n (0 is the lowest) of a 16-bit value, n is 0 or 1. */
uint8_t byte_of(uint16_t x, uint8_t n) {
    return (x >> (n << 3)) & 255;
}

/* Puzzle 4: 255 if the top bit of x is set, otherwise 0. */
uint8_t spread_top(uint8_t x) {
    uint8_t m = x >> 7;
    m = m | (m << 1);
    m = m | (m << 2);
    m = m | (m << 4);
    return m;
}

/* Puzzle 5: the negative of x in 8 bits (that is, 256 - x, wrapped), without using -. */
uint8_t negate(uint8_t x) {
    return ~x + 1;
}

/* Puzzle 6: 1 if x is a power of two (1, 2, 4, 8, ...), otherwise 0. */
int is_pow2(uint16_t x) {
    return (x != 0) & ((x & (x - 1)) == 0);
}

int main(void) {
    printf("bitlab: run the tests to check your puzzles\n");
    return 0;
}
