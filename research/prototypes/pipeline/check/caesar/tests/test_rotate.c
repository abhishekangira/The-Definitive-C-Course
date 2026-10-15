// Unit tests for rotate(). The runner compiles this file with
//   -DLEARNER_SRC="\"/abs/path/caesar.c\""  and  -I <dir containing check.h>
// so the learner's file is #included (static helpers are testable too) and their
// main() is renamed out of the way.
#include "check.h"
#define main learner_main
#include LEARNER_SRC
#undef main

int main(void) {
    CHECK_EQ_CHAR(rotate('a', 1), 'b', "rotate('a', 1) gives 'b'");
    CHECK_EQ_CHAR(rotate('z', 1), 'a', "rotate('z', 1) wraps to 'a'");
    CHECK_EQ_CHAR(rotate('Z', 3), 'C', "rotate('Z', 3) wraps to 'C' (uppercase)");
    CHECK_EQ_CHAR(rotate('!', 5), '!', "rotate('!', 5) leaves punctuation alone");
    CHECK_EQ_CHAR(rotate('m', 0), 'm', "rotate('m', 0) is a no-op");
    return CHECK_RESULT();
}
