#include <stdio.h>
#include <string.h>

int main(void) {
    char name[16];
    int age = 0;
    printf("Name: ");
    if (scanf("%15s %d", name, &age) != 2) {
        return 1;
    }
    size_t len = strlen(name);
    printf("Hello, %s (%zu chars), age %d\n", name, len, age);
    return 0;
}
