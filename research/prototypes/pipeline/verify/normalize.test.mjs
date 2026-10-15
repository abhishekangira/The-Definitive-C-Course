import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, parseDiagnostics } from "./lib/normalize.mjs";
import { parseMeta } from "./lib/meta.mjs";

test("pointer equality preserved, first-seen order", () => {
  const out = "a=0x7ffd5e0c1a2c b=0x7ffd5e0c1a28 p=0x7ffd5e0c1a2c q=(nil) h=0xff n=0x0";
  assert.equal(normalize(out), "a=<addr1> b=<addr2> p=<addr1> q=<NULL> h=0xff n=<NULL>");
});
test("macOS-style and leading zeros map to the same token", () => {
  assert.equal(normalize("0x16fdff0ac 0x000000016fdff0ac"), "<addr1> <addr1>");
});
test("shared map across stdout/stderr", () => {
  const map = new Map();
  normalize("p=0x5555555592a0", { map });
  assert.equal(normalize("==4242==ERROR at 0x5555555592a0", { map }), "==PID==ERROR at <addr1>");
});
test("wasm32-sized addresses (5 digits) still normalised; 4-digit hex kept", () => {
  assert.equal(normalize("p=0x110a0 mask=0xbeef"), "p=<addr1> mask=0xbeef");
});
test("mode none / all-hex", () => {
  assert.equal(normalize("0x7ffd5e0c1a2c", { mode: "none" }), "0x7ffd5e0c1a2c");
  assert.equal(normalize("0x10 0x10", { mode: "all-hex" }), "<addr1> <addr1>");
});
test("meta parsing", () => {
  assert.deepEqual(parseMeta('id=x run predict stdin="3 4\\n" expect=compile-error sanitize=address,undefined args=\'-n 5\''),
    { id: "x", run: true, predict: true, stdin: "3 4\n", expect: "compile-error", sanitize: "address,undefined", args: "-n 5" });
});
test("diagnostic flags normalised across gcc/clang", () => {
  const d = parseDiagnostics("a.c:4:9: error: unused variable 'u' [-Werror=unused-variable]\nb.c:5:20: warning: format specifies type 'int' [-Wformat]\nc.c:5:14: warning: format '%d' expects [-Wformat=]\nd.c:4:9: error: unused variable 'u' [-Werror,-Wunused-variable]");
  assert.deepEqual(d.map((x) => x.flag), ["-Wunused-variable", "-Wformat", "-Wformat", "-Wunused-variable"]);
});
import { rebaseAddresses } from "./lib/normalize.mjs";
test("rebase: ASLR-independent, offsets preserved", () => {
  const r1 = "&a=0x7ffe6140dbf0 &b=0x7ffe6140dbf4\nh1=0x5569eee302a0 h2=0x5569eee302c0\n&g=0x5569e9014010\n";
  const r2 = "&a=0x7ffde653c5b0 &b=0x7ffde653c5b4\nh1=0x5623263112a0 h2=0x5623263112c0\n&g=0x5622f2d0b010\n";
  assert.equal(rebaseAddresses(r1), rebaseAddresses(r2));
  assert.equal(rebaseAddresses(r1), "&a=0x7ffd4a3c1bc0 &b=0x7ffd4a3c1bc4\nh1=0x55d0c24002a0 h2=0x55d0c24002c0\n&g=0x55d0c1400010\n");
});
