// Unit tests for rotate(). The runner compiles this file inside a generated harness that #includes
// the learner's caesar.c with main() renamed, so static helpers are testable too. The #include below
// is only for editors: the harness has already included check.h.
#include "check.h"

int main(void) {
    CHECK_EQ_CHAR(rotate('a', 1), 'b', "rotate('a', 1) gives 'b'");
    CHECK_EQ_CHAR(rotate('z', 1), 'a', "rotate('z', 1) wraps to 'a'");
    CHECK_EQ_CHAR(rotate('Z', 3), 'C', "rotate('Z', 3) wraps to 'C' (uppercase)");
    CHECK_EQ_CHAR(rotate('!', 5), '!', "rotate('!', 5) leaves punctuation alone");
    CHECK_EQ_CHAR(rotate('m', 0), 'm', "rotate('m', 0) is a no-op");
    return 0;
}
