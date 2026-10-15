#include <stdio.h>
#include <signal.h>
#include <stdlib.h>
static void handler(int s) { printf("caught signal %d\n", s); fflush(stdout); exit(7); }
int main(void) { signal(SIGINT, handler); raise(SIGINT); puts("not reached"); return 0; }
