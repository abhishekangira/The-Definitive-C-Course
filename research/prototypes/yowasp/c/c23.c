#include <stdio.h>

int main(void) {
    constexpr int n = 0b1010'1010;
    auto x = n;
    bool ok = true;
    typeof(x) y = nullptr == nullptr;
    printf("%d %d %d %u %ld\n", x, ok, y, (unsigned)__builtin_popcount(255u), __STDC_VERSION__);
}
