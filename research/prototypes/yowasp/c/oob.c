#include <stdio.h>
#include <stdlib.h>
int g_before = 111;
int arr[4];
int g_after = 222;
int main(void) {
    int local_guard = 0x1234;
    int buf[4] = {0};
    for (int i = 0; i <= 8; i++) buf[i] = 0xBAD;   /* stack OOB write */
    printf("local_guard after stack OOB: %#x\n", local_guard);
    for (int i = 0; i < 16; i++) arr[i] = 7;       /* global OOB write */
    printf("g_before=%d g_after=%d\n", g_before, g_after);
    char *h = malloc(8);
    for (int i = 0; i < 64; i++) h[i] = 'A';        /* heap OOB write */
    printf("heap overflow done\n");
    free(h);
    printf("free after overflow done\n");
    char *big = malloc(16);
    printf("read far beyond: %d\n", big[100000]);
    printf("read beyond 4GiB-ish: \n"); fflush(stdout);
    volatile char *far = (char *)0xFFFFFFF0u;
    printf("%d\n", *far);
    return 0;
}
