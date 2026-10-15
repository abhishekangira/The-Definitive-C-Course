#include <stdio.h>
#include <string.h>
void vulnerable(const char *in) { char buf[8]; strcpy(buf, in); printf("copied: %s\n", buf); }
int main(void) { vulnerable("this string is way longer than eight bytes"); puts("returned normally"); return 0; }
