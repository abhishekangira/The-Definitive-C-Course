#include <stdio.h>
#include <stdlib.h>
int main(void) {
    FILE *in = fopen("input.txt", "r");
    if (!in) { perror("fopen input.txt"); return 1; }
    char line[64]; int n = 0;
    while (fgets(line, sizeof line, in)) n++;
    fclose(in);
    FILE *out = fopen("out/result.bin", "wb");
    if (!out) { perror("fopen out/result.bin"); return 2; }
    unsigned char bytes[4] = {0xDE, 0xAD, 0xBE, 0xEF};
    fwrite(bytes, 1, 4, out); fclose(out);
    FILE *missing = fopen("nope.txt", "r");
    if (!missing) perror("fopen nope.txt");
    printf("lines=%d\n", n);
    return 0;
}
