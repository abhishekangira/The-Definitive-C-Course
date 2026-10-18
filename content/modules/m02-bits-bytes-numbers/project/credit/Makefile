# Make-3.81-safe (the version macOS ships). `make` builds, `make test` runs the checks.
CC ?= cc
CFLAGS = -std=c17 -Wall -Wextra -pedantic -g -O0

credit: credit.c learnc.h
	$(CC) $(CFLAGS) -o credit credit.c -lm

test:
	node check.mjs

clean:
	rm -f credit

.PHONY: test clean
