#include <stdio.h>
#include <math.h>
int main(void) {
    volatile double two = 2.0;
    printf("sqrt=%.15f pow=%.3f sin=%.15f cos=%.15f exp=%.15f log=%.15f\n", sqrt(two), pow(two, 10.5), sin(two), cos(two), exp(two), log(two));
    printf("floor=%f ceil=%f round=%f fabs=%f fmod=%f hypot=%f atan2=%.15f\n", floor(-2.5), ceil(-2.5), round(2.5), fabs(-3.0), fmod(7.5, two), hypot(3, 4), atan2(1, two));
    printf("tgamma=%.15g lgamma=%.15g cbrt=%.15g erf=%.15g\n", tgamma(5.5), lgamma(100.0), cbrt(27.0), erf(0.5));
    printf("isnan=%d isinf=%d NAN=%f INFINITY=%f PI=%.15f\n", isnan(NAN), isinf(INFINITY), NAN, INFINITY, acos(-1.0));
    printf("sinf=%.9g powl=%.20Lg\n", sinf(1.0f), powl(2.0L, 0.5L));
    return 0;
}
