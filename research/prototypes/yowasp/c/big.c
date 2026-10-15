#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static int f0(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 2 == 0) s += a[i] * 0; else s -= a[i] / 1; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f1(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 3 == 0) s += a[i] * 1; else s -= a[i] / 2; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f2(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 4 == 0) s += a[i] * 2; else s -= a[i] / 3; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f3(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 5 == 0) s += a[i] * 3; else s -= a[i] / 4; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f4(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 6 == 0) s += a[i] * 4; else s -= a[i] / 5; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f5(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 7 == 0) s += a[i] * 5; else s -= a[i] / 6; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f6(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 8 == 0) s += a[i] * 6; else s -= a[i] / 7; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f7(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 9 == 0) s += a[i] * 7; else s -= a[i] / 8; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f8(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 10 == 0) s += a[i] * 8; else s -= a[i] / 9; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f9(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 11 == 0) s += a[i] * 9; else s -= a[i] / 10; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f10(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 12 == 0) s += a[i] * 10; else s -= a[i] / 11; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f11(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 13 == 0) s += a[i] * 11; else s -= a[i] / 12; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f12(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 14 == 0) s += a[i] * 12; else s -= a[i] / 13; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f13(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 15 == 0) s += a[i] * 13; else s -= a[i] / 14; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f14(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 16 == 0) s += a[i] * 14; else s -= a[i] / 15; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f15(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 17 == 0) s += a[i] * 15; else s -= a[i] / 16; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f16(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 18 == 0) s += a[i] * 16; else s -= a[i] / 17; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f17(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 19 == 0) s += a[i] * 17; else s -= a[i] / 18; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f18(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 20 == 0) s += a[i] * 18; else s -= a[i] / 19; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f19(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 21 == 0) s += a[i] * 19; else s -= a[i] / 20; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f20(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 22 == 0) s += a[i] * 20; else s -= a[i] / 21; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f21(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 23 == 0) s += a[i] * 21; else s -= a[i] / 22; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f22(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 24 == 0) s += a[i] * 22; else s -= a[i] / 23; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f23(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 25 == 0) s += a[i] * 23; else s -= a[i] / 24; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f24(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 26 == 0) s += a[i] * 24; else s -= a[i] / 25; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f25(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 27 == 0) s += a[i] * 25; else s -= a[i] / 26; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f26(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 28 == 0) s += a[i] * 26; else s -= a[i] / 27; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f27(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 29 == 0) s += a[i] * 27; else s -= a[i] / 28; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f28(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 30 == 0) s += a[i] * 28; else s -= a[i] / 29; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f29(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 31 == 0) s += a[i] * 29; else s -= a[i] / 30; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f30(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 32 == 0) s += a[i] * 30; else s -= a[i] / 31; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f31(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 33 == 0) s += a[i] * 31; else s -= a[i] / 32; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f32(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 34 == 0) s += a[i] * 32; else s -= a[i] / 33; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f33(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 35 == 0) s += a[i] * 33; else s -= a[i] / 34; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f34(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 36 == 0) s += a[i] * 34; else s -= a[i] / 35; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f35(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 37 == 0) s += a[i] * 35; else s -= a[i] / 36; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f36(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 38 == 0) s += a[i] * 36; else s -= a[i] / 37; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f37(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 39 == 0) s += a[i] * 37; else s -= a[i] / 38; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f38(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 40 == 0) s += a[i] * 38; else s -= a[i] / 39; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f39(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 41 == 0) s += a[i] * 39; else s -= a[i] / 40; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f40(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 42 == 0) s += a[i] * 40; else s -= a[i] / 41; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f41(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 43 == 0) s += a[i] * 41; else s -= a[i] / 42; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f42(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 44 == 0) s += a[i] * 42; else s -= a[i] / 43; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f43(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 45 == 0) s += a[i] * 43; else s -= a[i] / 44; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f44(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 46 == 0) s += a[i] * 44; else s -= a[i] / 45; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f45(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 47 == 0) s += a[i] * 45; else s -= a[i] / 46; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f46(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 48 == 0) s += a[i] * 46; else s -= a[i] / 47; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f47(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 49 == 0) s += a[i] * 47; else s -= a[i] / 48; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f48(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 50 == 0) s += a[i] * 48; else s -= a[i] / 49; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f49(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 51 == 0) s += a[i] * 49; else s -= a[i] / 50; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f50(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 52 == 0) s += a[i] * 50; else s -= a[i] / 51; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f51(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 53 == 0) s += a[i] * 51; else s -= a[i] / 52; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f52(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 54 == 0) s += a[i] * 52; else s -= a[i] / 53; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f53(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 55 == 0) s += a[i] * 53; else s -= a[i] / 54; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f54(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 56 == 0) s += a[i] * 54; else s -= a[i] / 55; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f55(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 57 == 0) s += a[i] * 55; else s -= a[i] / 56; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f56(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 58 == 0) s += a[i] * 56; else s -= a[i] / 57; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f57(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 59 == 0) s += a[i] * 57; else s -= a[i] / 58; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f58(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 60 == 0) s += a[i] * 58; else s -= a[i] / 59; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f59(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 61 == 0) s += a[i] * 59; else s -= a[i] / 60; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f60(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 62 == 0) s += a[i] * 60; else s -= a[i] / 61; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f61(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 63 == 0) s += a[i] * 61; else s -= a[i] / 62; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f62(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 64 == 0) s += a[i] * 62; else s -= a[i] / 63; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f63(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 65 == 0) s += a[i] * 63; else s -= a[i] / 64; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f64(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 66 == 0) s += a[i] * 64; else s -= a[i] / 65; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f65(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 67 == 0) s += a[i] * 65; else s -= a[i] / 66; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f66(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 68 == 0) s += a[i] * 66; else s -= a[i] / 67; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f67(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 69 == 0) s += a[i] * 67; else s -= a[i] / 68; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f68(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 70 == 0) s += a[i] * 68; else s -= a[i] / 69; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f69(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 71 == 0) s += a[i] * 69; else s -= a[i] / 70; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f70(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 72 == 0) s += a[i] * 70; else s -= a[i] / 71; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f71(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 73 == 0) s += a[i] * 71; else s -= a[i] / 72; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f72(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 74 == 0) s += a[i] * 72; else s -= a[i] / 73; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f73(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 75 == 0) s += a[i] * 73; else s -= a[i] / 74; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f74(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 76 == 0) s += a[i] * 74; else s -= a[i] / 75; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f75(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 77 == 0) s += a[i] * 75; else s -= a[i] / 76; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f76(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 78 == 0) s += a[i] * 76; else s -= a[i] / 77; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f77(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 79 == 0) s += a[i] * 77; else s -= a[i] / 78; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f78(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 80 == 0) s += a[i] * 78; else s -= a[i] / 79; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f79(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 81 == 0) s += a[i] * 79; else s -= a[i] / 80; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f80(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 82 == 0) s += a[i] * 80; else s -= a[i] / 81; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f81(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 83 == 0) s += a[i] * 81; else s -= a[i] / 82; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f82(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 84 == 0) s += a[i] * 82; else s -= a[i] / 83; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f83(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 85 == 0) s += a[i] * 83; else s -= a[i] / 84; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f84(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 86 == 0) s += a[i] * 84; else s -= a[i] / 85; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f85(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 87 == 0) s += a[i] * 85; else s -= a[i] / 86; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f86(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 88 == 0) s += a[i] * 86; else s -= a[i] / 87; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f87(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 89 == 0) s += a[i] * 87; else s -= a[i] / 88; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f88(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 90 == 0) s += a[i] * 88; else s -= a[i] / 89; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f89(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 91 == 0) s += a[i] * 89; else s -= a[i] / 90; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f90(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 92 == 0) s += a[i] * 90; else s -= a[i] / 91; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f91(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 93 == 0) s += a[i] * 91; else s -= a[i] / 92; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f92(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 94 == 0) s += a[i] * 92; else s -= a[i] / 93; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f93(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 95 == 0) s += a[i] * 93; else s -= a[i] / 94; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f94(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 96 == 0) s += a[i] * 94; else s -= a[i] / 95; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f95(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 97 == 0) s += a[i] * 95; else s -= a[i] / 96; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f96(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 98 == 0) s += a[i] * 96; else s -= a[i] / 97; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f97(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 99 == 0) s += a[i] * 97; else s -= a[i] / 98; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f98(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 100 == 0) s += a[i] * 98; else s -= a[i] / 99; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f99(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 101 == 0) s += a[i] * 99; else s -= a[i] / 100; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f100(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 102 == 0) s += a[i] * 100; else s -= a[i] / 101; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f101(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 103 == 0) s += a[i] * 101; else s -= a[i] / 102; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f102(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 104 == 0) s += a[i] * 102; else s -= a[i] / 103; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f103(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 105 == 0) s += a[i] * 103; else s -= a[i] / 104; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f104(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 106 == 0) s += a[i] * 104; else s -= a[i] / 105; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f105(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 107 == 0) s += a[i] * 105; else s -= a[i] / 106; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f106(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 108 == 0) s += a[i] * 106; else s -= a[i] / 107; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f107(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 109 == 0) s += a[i] * 107; else s -= a[i] / 108; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f108(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 110 == 0) s += a[i] * 108; else s -= a[i] / 109; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f109(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 111 == 0) s += a[i] * 109; else s -= a[i] / 110; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f110(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 112 == 0) s += a[i] * 110; else s -= a[i] / 111; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f111(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 113 == 0) s += a[i] * 111; else s -= a[i] / 112; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f112(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 114 == 0) s += a[i] * 112; else s -= a[i] / 113; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f113(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 115 == 0) s += a[i] * 113; else s -= a[i] / 114; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f114(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 116 == 0) s += a[i] * 114; else s -= a[i] / 115; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f115(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 117 == 0) s += a[i] * 115; else s -= a[i] / 116; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f116(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 118 == 0) s += a[i] * 116; else s -= a[i] / 117; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f117(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 119 == 0) s += a[i] * 117; else s -= a[i] / 118; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f118(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 120 == 0) s += a[i] * 118; else s -= a[i] / 119; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f119(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 121 == 0) s += a[i] * 119; else s -= a[i] / 120; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f120(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 122 == 0) s += a[i] * 120; else s -= a[i] / 121; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f121(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 123 == 0) s += a[i] * 121; else s -= a[i] / 122; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f122(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 124 == 0) s += a[i] * 122; else s -= a[i] / 123; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f123(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 125 == 0) s += a[i] * 123; else s -= a[i] / 124; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f124(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 126 == 0) s += a[i] * 124; else s -= a[i] / 125; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f125(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 127 == 0) s += a[i] * 125; else s -= a[i] / 126; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f126(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 128 == 0) s += a[i] * 126; else s -= a[i] / 127; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f127(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 129 == 0) s += a[i] * 127; else s -= a[i] / 128; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f128(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 130 == 0) s += a[i] * 128; else s -= a[i] / 129; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f129(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 131 == 0) s += a[i] * 129; else s -= a[i] / 130; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f130(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 132 == 0) s += a[i] * 130; else s -= a[i] / 131; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f131(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 133 == 0) s += a[i] * 131; else s -= a[i] / 132; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f132(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 134 == 0) s += a[i] * 132; else s -= a[i] / 133; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f133(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 135 == 0) s += a[i] * 133; else s -= a[i] / 134; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f134(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 136 == 0) s += a[i] * 134; else s -= a[i] / 135; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f135(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 137 == 0) s += a[i] * 135; else s -= a[i] / 136; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f136(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 138 == 0) s += a[i] * 136; else s -= a[i] / 137; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f137(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 139 == 0) s += a[i] * 137; else s -= a[i] / 138; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f138(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 140 == 0) s += a[i] * 138; else s -= a[i] / 139; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f139(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 141 == 0) s += a[i] * 139; else s -= a[i] / 140; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f140(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 142 == 0) s += a[i] * 140; else s -= a[i] / 141; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f141(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 143 == 0) s += a[i] * 141; else s -= a[i] / 142; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f142(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 144 == 0) s += a[i] * 142; else s -= a[i] / 143; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f143(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 145 == 0) s += a[i] * 143; else s -= a[i] / 144; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f144(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 146 == 0) s += a[i] * 144; else s -= a[i] / 145; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f145(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 147 == 0) s += a[i] * 145; else s -= a[i] / 146; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f146(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 148 == 0) s += a[i] * 146; else s -= a[i] / 147; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f147(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 149 == 0) s += a[i] * 147; else s -= a[i] / 148; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f148(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 150 == 0) s += a[i] * 148; else s -= a[i] / 149; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f149(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 151 == 0) s += a[i] * 149; else s -= a[i] / 150; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f150(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 152 == 0) s += a[i] * 150; else s -= a[i] / 151; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f151(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 153 == 0) s += a[i] * 151; else s -= a[i] / 152; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f152(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 154 == 0) s += a[i] * 152; else s -= a[i] / 153; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f153(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 155 == 0) s += a[i] * 153; else s -= a[i] / 154; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f154(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 156 == 0) s += a[i] * 154; else s -= a[i] / 155; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f155(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 157 == 0) s += a[i] * 155; else s -= a[i] / 156; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f156(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 158 == 0) s += a[i] * 156; else s -= a[i] / 157; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f157(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 159 == 0) s += a[i] * 157; else s -= a[i] / 158; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f158(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 160 == 0) s += a[i] * 158; else s -= a[i] / 159; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f159(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 161 == 0) s += a[i] * 159; else s -= a[i] / 160; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f160(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 162 == 0) s += a[i] * 160; else s -= a[i] / 161; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f161(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 163 == 0) s += a[i] * 161; else s -= a[i] / 162; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f162(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 164 == 0) s += a[i] * 162; else s -= a[i] / 163; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f163(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 165 == 0) s += a[i] * 163; else s -= a[i] / 164; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f164(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 166 == 0) s += a[i] * 164; else s -= a[i] / 165; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f165(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 167 == 0) s += a[i] * 165; else s -= a[i] / 166; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f166(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 168 == 0) s += a[i] * 166; else s -= a[i] / 167; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f167(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 169 == 0) s += a[i] * 167; else s -= a[i] / 168; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f168(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 170 == 0) s += a[i] * 168; else s -= a[i] / 169; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f169(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 171 == 0) s += a[i] * 169; else s -= a[i] / 170; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f170(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 172 == 0) s += a[i] * 170; else s -= a[i] / 171; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f171(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 173 == 0) s += a[i] * 171; else s -= a[i] / 172; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f172(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 174 == 0) s += a[i] * 172; else s -= a[i] / 173; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f173(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 175 == 0) s += a[i] * 173; else s -= a[i] / 174; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f174(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 176 == 0) s += a[i] * 174; else s -= a[i] / 175; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f175(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 177 == 0) s += a[i] * 175; else s -= a[i] / 176; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f176(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 178 == 0) s += a[i] * 176; else s -= a[i] / 177; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f177(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 179 == 0) s += a[i] * 177; else s -= a[i] / 178; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f178(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 180 == 0) s += a[i] * 178; else s -= a[i] / 179; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f179(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 181 == 0) s += a[i] * 179; else s -= a[i] / 180; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f180(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 182 == 0) s += a[i] * 180; else s -= a[i] / 181; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f181(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 183 == 0) s += a[i] * 181; else s -= a[i] / 182; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f182(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 184 == 0) s += a[i] * 182; else s -= a[i] / 183; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f183(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 185 == 0) s += a[i] * 183; else s -= a[i] / 184; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f184(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 186 == 0) s += a[i] * 184; else s -= a[i] / 185; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f185(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 187 == 0) s += a[i] * 185; else s -= a[i] / 186; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f186(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 188 == 0) s += a[i] * 186; else s -= a[i] / 187; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f187(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 189 == 0) s += a[i] * 187; else s -= a[i] / 188; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f188(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 190 == 0) s += a[i] * 188; else s -= a[i] / 189; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f189(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 191 == 0) s += a[i] * 189; else s -= a[i] / 190; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f190(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 192 == 0) s += a[i] * 190; else s -= a[i] / 191; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f191(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 193 == 0) s += a[i] * 191; else s -= a[i] / 192; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f192(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 194 == 0) s += a[i] * 192; else s -= a[i] / 193; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f193(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 195 == 0) s += a[i] * 193; else s -= a[i] / 194; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f194(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 196 == 0) s += a[i] * 194; else s -= a[i] / 195; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f195(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 197 == 0) s += a[i] * 195; else s -= a[i] / 196; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f196(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 198 == 0) s += a[i] * 196; else s -= a[i] / 197; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f197(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 199 == 0) s += a[i] * 197; else s -= a[i] / 198; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f198(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 200 == 0) s += a[i] * 198; else s -= a[i] / 199; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
static int f199(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) { if (a[i] % 201 == 0) s += a[i] * 199; else s -= a[i] / 200; } char buf[64]; snprintf(buf, sizeof buf, "%d", s); return (int)strlen(buf) + s; }
int main(void) { int a[100]; for (int i = 0; i < 100; i++) a[i] = i * 31 % 97; long t = 0;
  t += f0(a, 100);
  t += f1(a, 100);
  t += f2(a, 100);
  t += f3(a, 100);
  t += f4(a, 100);
  t += f5(a, 100);
  t += f6(a, 100);
  t += f7(a, 100);
  t += f8(a, 100);
  t += f9(a, 100);
  t += f10(a, 100);
  t += f11(a, 100);
  t += f12(a, 100);
  t += f13(a, 100);
  t += f14(a, 100);
  t += f15(a, 100);
  t += f16(a, 100);
  t += f17(a, 100);
  t += f18(a, 100);
  t += f19(a, 100);
  t += f20(a, 100);
  t += f21(a, 100);
  t += f22(a, 100);
  t += f23(a, 100);
  t += f24(a, 100);
  t += f25(a, 100);
  t += f26(a, 100);
  t += f27(a, 100);
  t += f28(a, 100);
  t += f29(a, 100);
  t += f30(a, 100);
  t += f31(a, 100);
  t += f32(a, 100);
  t += f33(a, 100);
  t += f34(a, 100);
  t += f35(a, 100);
  t += f36(a, 100);
  t += f37(a, 100);
  t += f38(a, 100);
  t += f39(a, 100);
  t += f40(a, 100);
  t += f41(a, 100);
  t += f42(a, 100);
  t += f43(a, 100);
  t += f44(a, 100);
  t += f45(a, 100);
  t += f46(a, 100);
  t += f47(a, 100);
  t += f48(a, 100);
  t += f49(a, 100);
  t += f50(a, 100);
  t += f51(a, 100);
  t += f52(a, 100);
  t += f53(a, 100);
  t += f54(a, 100);
  t += f55(a, 100);
  t += f56(a, 100);
  t += f57(a, 100);
  t += f58(a, 100);
  t += f59(a, 100);
  t += f60(a, 100);
  t += f61(a, 100);
  t += f62(a, 100);
  t += f63(a, 100);
  t += f64(a, 100);
  t += f65(a, 100);
  t += f66(a, 100);
  t += f67(a, 100);
  t += f68(a, 100);
  t += f69(a, 100);
  t += f70(a, 100);
  t += f71(a, 100);
  t += f72(a, 100);
  t += f73(a, 100);
  t += f74(a, 100);
  t += f75(a, 100);
  t += f76(a, 100);
  t += f77(a, 100);
  t += f78(a, 100);
  t += f79(a, 100);
  t += f80(a, 100);
  t += f81(a, 100);
  t += f82(a, 100);
  t += f83(a, 100);
  t += f84(a, 100);
  t += f85(a, 100);
  t += f86(a, 100);
  t += f87(a, 100);
  t += f88(a, 100);
  t += f89(a, 100);
  t += f90(a, 100);
  t += f91(a, 100);
  t += f92(a, 100);
  t += f93(a, 100);
  t += f94(a, 100);
  t += f95(a, 100);
  t += f96(a, 100);
  t += f97(a, 100);
  t += f98(a, 100);
  t += f99(a, 100);
  t += f100(a, 100);
  t += f101(a, 100);
  t += f102(a, 100);
  t += f103(a, 100);
  t += f104(a, 100);
  t += f105(a, 100);
  t += f106(a, 100);
  t += f107(a, 100);
  t += f108(a, 100);
  t += f109(a, 100);
  t += f110(a, 100);
  t += f111(a, 100);
  t += f112(a, 100);
  t += f113(a, 100);
  t += f114(a, 100);
  t += f115(a, 100);
  t += f116(a, 100);
  t += f117(a, 100);
  t += f118(a, 100);
  t += f119(a, 100);
  t += f120(a, 100);
  t += f121(a, 100);
  t += f122(a, 100);
  t += f123(a, 100);
  t += f124(a, 100);
  t += f125(a, 100);
  t += f126(a, 100);
  t += f127(a, 100);
  t += f128(a, 100);
  t += f129(a, 100);
  t += f130(a, 100);
  t += f131(a, 100);
  t += f132(a, 100);
  t += f133(a, 100);
  t += f134(a, 100);
  t += f135(a, 100);
  t += f136(a, 100);
  t += f137(a, 100);
  t += f138(a, 100);
  t += f139(a, 100);
  t += f140(a, 100);
  t += f141(a, 100);
  t += f142(a, 100);
  t += f143(a, 100);
  t += f144(a, 100);
  t += f145(a, 100);
  t += f146(a, 100);
  t += f147(a, 100);
  t += f148(a, 100);
  t += f149(a, 100);
  t += f150(a, 100);
  t += f151(a, 100);
  t += f152(a, 100);
  t += f153(a, 100);
  t += f154(a, 100);
  t += f155(a, 100);
  t += f156(a, 100);
  t += f157(a, 100);
  t += f158(a, 100);
  t += f159(a, 100);
  t += f160(a, 100);
  t += f161(a, 100);
  t += f162(a, 100);
  t += f163(a, 100);
  t += f164(a, 100);
  t += f165(a, 100);
  t += f166(a, 100);
  t += f167(a, 100);
  t += f168(a, 100);
  t += f169(a, 100);
  t += f170(a, 100);
  t += f171(a, 100);
  t += f172(a, 100);
  t += f173(a, 100);
  t += f174(a, 100);
  t += f175(a, 100);
  t += f176(a, 100);
  t += f177(a, 100);
  t += f178(a, 100);
  t += f179(a, 100);
  t += f180(a, 100);
  t += f181(a, 100);
  t += f182(a, 100);
  t += f183(a, 100);
  t += f184(a, 100);
  t += f185(a, 100);
  t += f186(a, 100);
  t += f187(a, 100);
  t += f188(a, 100);
  t += f189(a, 100);
  t += f190(a, 100);
  t += f191(a, 100);
  t += f192(a, 100);
  t += f193(a, 100);
  t += f194(a, 100);
  t += f195(a, 100);
  t += f196(a, 100);
  t += f197(a, 100);
  t += f198(a, 100);
  t += f199(a, 100);
  printf("%ld\n", t); return 0; }
