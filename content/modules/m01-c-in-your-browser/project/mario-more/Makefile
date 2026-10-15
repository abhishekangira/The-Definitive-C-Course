# Make-3.81-safe (the version macOS ships). `make` builds, `make test` runs the checks.
CC ?= cc
CFLAGS = -std=c17 -Wall -Wextra -pedantic -g -O0

mario: mario.c learnc.h
	$(CC) $(CFLAGS) -o mario mario.c -lm

test:
	node check.mjs

clean:
	rm -f mario

.PHONY: test clean
