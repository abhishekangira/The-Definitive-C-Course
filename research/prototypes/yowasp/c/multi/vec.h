#ifndef VEC_H
#define VEC_H
#include <stddef.h>
typedef struct { int *data; size_t len, cap; } Vec;
Vec vec_new(void);
void vec_push(Vec *v, int x);
int vec_sum(const Vec *v);
void vec_free(Vec *v);
#endif
