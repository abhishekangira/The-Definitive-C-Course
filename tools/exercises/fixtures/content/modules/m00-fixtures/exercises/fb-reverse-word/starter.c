#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char *reverse(const char *s) {
    size_t n = strlen(s);
    char *out = malloc(n);
    if (out == NULL) {
        return NULL;
    }
    for (size_t i = 0; i < n; i++) {
        out[i] = s[n - 1 - i];
    }
    out[n] = '\0';
    return out;
}

int main(void) {
    char word[64];
    if (scanf("%63s", word) != 1) {
        return 1;
    }
    char *r = reverse(word);
    if (r == NULL) {
        return 1;
    }
    printf("%s\n", r);
    return 0;
}
