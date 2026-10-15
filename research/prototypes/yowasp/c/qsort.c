#include <stdio.h>
#include <stdlib.h>
typedef struct { int key; int order; } Item;
static int cmp(const void *a, const void *b) { const Item *x = a, *y = b; return (x->key > y->key) - (x->key < y->key); }
int main(void) {
    enum { N = 40 };
    Item items[N];
    for (int i = 0; i < N; i++) { items[i].key = (i * 7) % 3; items[i].order = i; }
    qsort(items, N, sizeof(Item), cmp);
    int stable = 1;
    for (int i = 1; i < N; i++) if (items[i].key == items[i-1].key && items[i].order < items[i-1].order) stable = 0;
    printf("stable=%d first10:", stable);
    for (int i = 0; i < 10; i++) printf(" (%d,%d)", items[i].key, items[i].order);
    printf("\n");
    return 0;
}
