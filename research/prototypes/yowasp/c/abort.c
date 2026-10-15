#include <stdio.h>
#include <stdlib.h>
int main(void) { printf("before abort\n"); fflush(stdout); abort(); }
