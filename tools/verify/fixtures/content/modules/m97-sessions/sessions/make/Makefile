credit: main.o luhn.o
	$(CC) -o credit main.o luhn.o

main.o: main.c luhn.h
	$(CC) $(CFLAGS) -c main.c

luhn.o: luhn.c luhn.h
	$(CC) $(CFLAGS) -c luhn.c

.PHONY: clean
clean:
	rm -f credit main.o luhn.o
