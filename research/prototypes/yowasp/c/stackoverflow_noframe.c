#include <stdio.h>
int f(int n) { return f(n + 1) + 1; }
int main(void) { printf("start\n"); fflush(stdout); return f(0); }
