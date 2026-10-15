#include <stdio.h>
#include <stdlib.h>
int g; int main(void){ int l; char *h = malloc(10); printf("%p %p %p %p\n", (void*)&l, (void*)&g, (void*)h, (void*)main); return 0; }