// Starter code, part-way done (this is what a learner might have mid-exercise).
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char rotate(char c, int key) {
    if (isalpha((unsigned char)c)) {
        return (char)(c + key);          // TODO: wrap around past 'z'
    }
    return c;
}

int main(int argc, char *argv[]) {
    int key = atoi(argv[1]);             // TODO: validate argc / argv[1]
    char line[256];
    if (fgets(line, sizeof line, stdin) == NULL) {
        return 1;
    }
    line[strcspn(line, "\n")] = '\0';
    size_t n = strlen(line);
    char *out = malloc(n);               // TODO: room for the '\0'?
    for (size_t i = 0; i < n; i++) {
        out[i] = rotate(line[i], key);
    }
    out[n] = '\0';
    printf("ciphertext: %s\n", out);
    return 0;                            // TODO: free what you malloc
}
