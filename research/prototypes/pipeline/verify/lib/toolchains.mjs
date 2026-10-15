// Toolchain adapters. Every adapter implements the same interface so the verifier can
// diff native gcc / native clang / in-browser wasm clang uniformly:
//
//   interface Toolchain {
//     name: string;                       // "gcc" | "clang" | "wasm-clang"
//     abi: "lp64" | "ilp32" | ...;        // data model, used to explain sizeof diffs
//     version(): Promise<string>;
//     compile(req: {dir, sources:{name,code}[], flags:string[], sanitize:string[]})
//        : Promise<{ok, exitCode, stderr, diagnostics, artifact?, durationMs}>;
//     run(artifact, {stdin, args, timeoutMs, env})
//        : Promise<{exitCode, signal, stdout, stderr, timedOut, durationMs}>;
//   }
//
// The wasm adapter (teammate: @yowasp/clang in Node) compiles to wasm32-wasi and runs the
// module under node:wasi with stdin/args/preopens; it must report abi:"ilp32" so the diff
// step can label sizeof(long)/pointer-width differences as expected-by-ABI.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDiagnostics } from "./normalize.mjs";

const BASE_FLAGS = (std) => [`-std=${std}`, "-Wall", "-Wextra", "-pedantic", "-g", "-O0"];

function sh(cmd, args, opts = {}) {
  const t0 = performance.now();
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 4 << 20, ...opts });
  return { ...r, durationMs: Math.round(performance.now() - t0) };
}

export function nativeToolchain(name) {
  const cc = name; // "gcc" | "clang" (could be "gcc-14", "clang-18", ...)
  return {
    name,
    abi: "lp64",
    async version() { return sh(cc, ["--version"]).stdout.split("\n")[0]; },
    async compile({ dir, sources, std = "c17", werror = true, sanitize = [], extraFlags = [], lm = false }) {
      for (const s of sources) writeFileSync(join(dir, s.name), s.code);
      const out = join(dir, `prog-${name}`);
      const flags = [...BASE_FLAGS(std), "-fdiagnostics-color=never",
        ...(werror ? ["-Werror"] : []),
        ...(sanitize.length ? [`-fsanitize=${sanitize.join(",")}`, "-fno-omit-frame-pointer", "-fno-sanitize-recover=all"] : []),
        ...extraFlags];
      const args = [...flags, ...sources.filter((s) => s.name.endsWith(".c")).map((s) => s.name), "-o", out, ...(lm ? ["-lm"] : [])];
      const r = sh(cc, args, { cwd: dir });
      return { ok: r.status === 0, exitCode: r.status, stderr: r.stderr, diagnostics: parseDiagnostics(r.stderr),
               artifact: r.status === 0 ? out : null, command: [cc, ...args].join(" "), durationMs: r.durationMs };
    },
    async run(artifact, { stdin = "", args = [], timeoutMs = 3000, cwd }) {
      const env = { ...process.env,
        ASAN_OPTIONS: "detect_leaks=1:abort_on_error=0:exitcode=86:color=never",
        // NB: `exitcode` is a common sanitizer flag; setting it in LSAN_OPTIONS too would
        // override ASan's (verified: heap-overflow exited 88). Classify via stderr instead.
        UBSAN_OPTIONS: "print_stacktrace=1:halt_on_error=1:exitcode=87:color=never" };
      const r = sh(artifact, args, { input: stdin, timeout: timeoutMs, killSignal: "SIGKILL", cwd, env });
      const timedOut = r.error?.code === "ETIMEDOUT";
      return { exitCode: r.status, signal: r.signal, stdout: r.stdout ?? "", stderr: r.stderr ?? "",
               timedOut, durationMs: r.durationMs };
    },
  };
}
