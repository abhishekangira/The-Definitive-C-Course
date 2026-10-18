#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int value;
    struct Node *next;
} Node;

int main(void) {
    Node *head = NULL;
    int v;
    int count = 0;
    while (scanf("%d", &v) == 1) {
        Node *n = malloc(sizeof *n);
        if (n == NULL) {
            return 1;
        }
        n->value = v;
        n->next = head;
        head = n;
        count++;
    }
    printf("count: %d\n", count);
    free(head);
    return 0;
}
