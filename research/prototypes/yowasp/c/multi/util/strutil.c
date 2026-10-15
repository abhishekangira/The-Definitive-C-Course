#include <ctype.h>
#include "strutil.h"
void str_upper(char *s) { for (; *s; s++) *s = (char)toupper((unsigned char)*s); }
