#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int value;
    struct Node *next;
} Node;

int main(void) {
    Node *head = NULL;
    int v;
    while (scanf("%d", &v) == 1) {
        Node *n = malloc(sizeof *n);
        if (n == NULL) {
            return 1;
        }
        n->value = v;
        n->next = head;
        head = n;
    }
    long sum = 0;
    for (Node *p = head; p != NULL; p = p->next) {
        sum += p->value;
    }
    printf("sum: %ld\n", sum);
    free(head);
    return 0;
}
