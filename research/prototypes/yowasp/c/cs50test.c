#include <cs50.h>
#include <stdio.h>
int main(void) {
    string name = get_string("What's your name? ");
    int age = get_int("Age: ");
    printf("hello, %s (%d)\n", name, age);
}
