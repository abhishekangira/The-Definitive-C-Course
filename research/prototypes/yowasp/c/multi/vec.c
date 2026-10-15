#include <stdlib.h>
#include "vec.h"
Vec vec_new(void) { return (Vec){0}; }
void vec_push(Vec *v, int x) {
    if (v->len == v->cap) { v->cap = v->cap ? v->cap * 2 : 4; v->data = realloc(v->data, v->cap * sizeof *v->data); }
    v->data[v->len++] = x;
}
int vec_sum(const Vec *v) { int s = 0; for (size_t i = 0; i < v->len; i++) s += v->data[i]; return s; }
void vec_free(Vec *v) { free(v->data); *v = (Vec){0}; }
