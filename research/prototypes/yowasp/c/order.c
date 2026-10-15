#include <stdio.h>
#include <unistd.h>
int main(void) {
    printf("out1\n"); fprintf(stderr, "err1\n"); printf("out2 no newline "); fprintf(stderr, "err2\n"); printf("out3\n");
    fprintf(stderr, "isatty(1)=%d isatty(0)=%d\n", isatty(1), isatty(0));
    return 0;
}
