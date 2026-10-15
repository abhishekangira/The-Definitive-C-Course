CC ?= cc
CFLAGS = -std=c17 -Wall -Wextra -pedantic -g -O0

greet: main.o greet.o
	$(CC) $(CFLAGS) -o greet main.o greet.o

main.o: main.c
	$(CC) $(CFLAGS) -c main.c

greet.o: greet.c
	$(CC) $(CFLAGS) -c greet.c

test:
	node check.mjs --cc "$(CC)"

clean:
	rm -f greet *.o

.PHONY: test clean
