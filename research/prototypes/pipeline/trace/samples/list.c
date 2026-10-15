#include <stdio.h>
#include <stdlib.h>

typedef struct node {
    int value;
    struct node *next;
} node;

static int node_count = 0;

node *push(node *head, int value) {
    node *n = malloc(sizeof *n);
    if (n == NULL) {
        exit(1);
    }
    n->value = value;
    n->next = head;
    node_count++;
    return n;
}

int main(void) {
    node *list = NULL;
    for (int i = 1; i <= 3; i++) {
        list = push(list, i * 10);
    }
    for (node *p = list; p != NULL; p = p->next) {
        printf("%d\n", p->value);
    }
    while (list != NULL) {
        node *next = list->next;
        free(list);
        list = next;
    }
    return 0;
}
