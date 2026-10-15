#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
int main(void) {
    int *a = malloc(10 * sizeof *a);
    if (!a) return 1;
    for (int i = 0; i < 10; i++) a[i] = i * i;
    a = realloc(a, 1000 * sizeof *a);
    if (!a) return 2;
    for (int i = 10; i < 1000; i++) a[i] = i;
    long sum = 0;
    for (int i = 0; i < 1000; i++) sum += a[i];
    printf("sum=%ld\n", sum);
    char *s = strdup("hello heap");
    printf("%s len=%zu\n", s, strlen(s));
    free(s);
    free(a);
    int *c = calloc(4, sizeof(int));
    printf("calloc zeroed: %d %d %d %d\n", c[0], c[1], c[2], c[3]);
    free(c);
    void *huge = malloc((size_t)3 * 1024 * 1024 * 1024);
    printf("malloc(3GiB) %s\n", huge ? "succeeded" : "returned NULL");
    free(huge);
    void *huge2 = malloc(SIZE_MAX / 2);
    printf("malloc(SIZE_MAX/2) %s\n", huge2 ? "succeeded" : "returned NULL");
    /* allocate until failure in 1 MiB chunks */
    size_t mb = 0; void *p;
    while ((p = malloc(1 << 20)) != NULL && mb < 8192) mb++;
    printf("allocated %zu MiB before failure\n", mb);
    return 0;
}
