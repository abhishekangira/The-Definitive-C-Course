# Caesar cipher

`./caesar KEY` reads one line from standard input and prints it with every letter rotated KEY places
through the alphabet (wrapping from z back to a), keeping case and leaving everything else alone:

```
$ ./caesar 13
Hello, World!
ciphertext: Uryyb, Jbeyq!
```

With a missing or non-numeric key it prints `Usage: ./caesar key` to stderr and exits with status 1.

Run `make test` to check your work.
