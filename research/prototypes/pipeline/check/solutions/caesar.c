// Reference solution: ./caesar KEY  reads one line from stdin, prints the rotated text.
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char rotate(char c, int key) {
    if (isupper((unsigned char)c)) {
        return (char)('A' + (c - 'A' + key) % 26);
    }
    if (islower((unsigned char)c)) {
        return (char)('a' + (c - 'a' + key) % 26);
    }
    return c;
}

static int parse_key(const char *s, int *key) {
    if (*s == '\0') {
        return 0;
    }
    for (const char *p = s; *p != '\0'; p++) {
        if (!isdigit((unsigned char)*p)) {
            return 0;
        }
    }
    *key = (int)(strtol(s, NULL, 10) % 26);
    return 1;
}

int main(int argc, char *argv[]) {
    int key;
    if (argc != 2 || !parse_key(argv[1], &key)) {
        fprintf(stderr, "Usage: ./caesar key\n");
        return 1;
    }
    char line[256];
    if (fgets(line, sizeof line, stdin) == NULL) {
        return 1;
    }
    line[strcspn(line, "\n")] = '\0';
    size_t n = strlen(line);
    char *out = malloc(n + 1);
    if (out == NULL) {
        return 1;
    }
    for (size_t i = 0; i < n; i++) {
        out[i] = rotate(line[i], key);
    }
    out[n] = '\0';
    printf("ciphertext: %s\n", out);
    free(out);
    return 0;
}
