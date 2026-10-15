#include <stdio.h>
int main(void) { printf("spinning\n"); fflush(stdout); volatile unsigned long i = 0; for (;;) i++; }
