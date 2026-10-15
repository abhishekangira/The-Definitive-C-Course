#include <stdio.h>
#include <string.h>
int main(void) {
    int a, b;
    char name[32];
    char line[100];
    if (scanf("%d %d", &a, &b) != 2) { puts("scanf failed"); return 1; }
    printf("sum=%d\n", a + b);
    if (scanf("%31s", name) == 1) printf("name=%s\n", name);
    int c = getchar(); /* consume newline */
    (void)c;
    if (fgets(line, sizeof line, stdin)) { line[strcspn(line, "\n")] = 0; printf("line=[%s]\n", line); }
    int count = 0;
    while ((c = getchar()) != EOF) count++;
    printf("remaining chars=%d, feof=%d\n", count, feof(stdin));
    double d;
    printf("scanf at EOF returns %d\n", scanf("%lf", &d));
    return 0;
}
