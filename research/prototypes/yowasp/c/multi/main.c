#include <stdio.h>
#include "vec.h"
#include "util/strutil.h"
int main(void) {
    Vec v = vec_new();
    for (int i = 1; i <= 5; i++) vec_push(&v, i * 10);
    printf("len=%zu sum=%d\n", v.len, vec_sum(&v));
    char s[] = "Hello Multi";
    str_upper(s);
    printf("%s\n", s);
    vec_free(&v);
    return 0;
}
