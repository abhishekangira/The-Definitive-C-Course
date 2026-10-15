#!/usr/bin/env node
// verify.mjs -- build-time sample verification for MDX lessons.
//   node verify.mjs lessons/ --out generated/samples.json [--only id] [--update]
// Exit code 1 if any sample violates its `expect`, or gcc/clang disagree on a
// non-`platform` sample.
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { extractBlocks, sampleConfig } from "./lib/meta.mjs";
import { normalize, lineDiff, summarizeSanitizer, rebaseAddresses } from "./lib/normalize.mjs";
import { nativeToolchain } from "./lib/toolchains.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const root = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--out" && argv[argv.indexOf(a) - 1] !== "--only") ?? "lessons";
const outFile = opt("--out", "generated/samples.json");
const only = opt("--only");

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.mdx?$/.test(f) ? [p] : [];
});

const toolchains = Object.fromEntries(["gcc", "clang"].map((n) => [n, nativeToolchain(n)]));
const versions = Object.fromEntries(await Promise.all(Object.entries(toolchains).map(async ([n, t]) => [n, await t.version()])));
// cache key includes the verifier's own source, so changing the pipeline re-verifies everything
const selfHash = createHash("sha256").update(["verify.mjs", "lib/meta.mjs", "lib/normalize.mjs", "lib/toolchains.mjs"]
  .map((f) => readFileSync(new URL(f, import.meta.url))).join("")).digest("hex").slice(0, 12);
const prev = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : { samples: {} };

const results = {};
const problems = [];
const ids = new Set();

for (const file of walk(root)) {
  for (const block of extractBlocks(readFileSync(file, "utf8"), relative(process.cwd(), file))) {
    const cfg = sampleConfig(block.meta);
    if (!cfg.id) { if (cfg.run) problems.push(`${block.file}:${block.line}: runnable block without id=`); continue; }
    if (ids.has(cfg.id)) problems.push(`${block.file}:${block.line}: duplicate id ${cfg.id}`);
    ids.add(cfg.id);
    if (only && cfg.id !== only) continue;

    // content hash (code + meta + compiler versions) -> skip unchanged samples
    const hash = createHash("sha256").update(JSON.stringify([block.code, block.metaRaw, versions, selfHash])).digest("hex").slice(0, 16);
    if (prev.samples[cfg.id]?.hash === hash && !argv.includes("--force")) { results[cfg.id] = prev.samples[cfg.id]; continue; }

    const dir = mkdtempSync(join(tmpdir(), `cv-${cfg.id}-`));
    const rec = { id: cfg.id, file: block.file, line: block.line, hash, meta: block.meta, expect: cfg.expect, toolchains: {}, issues: [] };
    const wantWarnings = ["warning", "compile-error", "ub"].includes(cfg.expect) || block.meta.werror === "false";
    for (const name of cfg.compilers) {
      const tc = toolchains[name];
      const c = await tc.compile({ dir, sources: [{ name: `${cfg.id}.c`, code: block.code }], std: cfg.std,
                                   werror: !wantWarnings, sanitize: cfg.sanitize, lm: cfg.lm });
      const t = { version: versions[name], command: c.command.replaceAll(dir, "<tmp>"),
                  compile: { ok: c.ok, exitCode: c.exitCode, diagnostics: c.diagnostics.map((d) => ({ ...d, file: d.file.replace(dir + "/", "") })),
                             stderr: normalize(c.stderr, { paths: [dir] }) } };
      if (c.ok && cfg.run) {
        const r = await tc.run(c.artifact, { stdin: cfg.stdin, args: cfg.args, timeoutMs: cfg.timeoutMs, cwd: dir });
        const map = new Map(); // one map per run => stdout/stderr tokens consistent
        t.run = { exitCode: r.exitCode, signal: r.signal, timedOut: r.timedOut, durationMs: r.durationMs,
                  stdoutDisplay: rebaseAddresses(r.stdout),   // stable, offset-preserving (for lesson UI)
                  stdout: normalize(r.stdout, { mode: cfg.norm, map }),
                  stderr: normalize(r.stderr, { mode: cfg.norm, map, paths: [dir] }) };
        const sz = summarizeSanitizer(t.run.stderr, `${cfg.id}.c`);
        if (sz) t.run.sanitizer = sz;
      }
      rec.toolchains[name] = t;
      if (!c.ok && cfg.sanitize.length && /libclang_rt\.\w+|cannot find -l(asan|ubsan)/.test(c.stderr)) {
        t.skipped = "sanitizer runtime not installed for " + name;   // e.g. clang without compiler-rt
        rec.issues.push({ level: "warn", toolchain: name, msg: t.skipped });
        continue;
      }
      checkExpect(cfg, name, t, rec.issues);
    }
    // cross-compiler agreement on normalised stdout + exit code
    const runs = cfg.compilers.map((n) => [n, rec.toolchains[n].run]).filter(([, r]) => r);
    if (runs.length > 1) {
      const [[n0, r0], ...rest] = runs;
      for (const [n, r] of rest) {
        if (r.stdout !== r0.stdout || r.exitCode !== r0.exitCode) {
          const msg = `${n0} vs ${n} output differs` + (cfg.platform ? " (platform-dependent: allowed)" : "");
          rec.issues.push({ level: cfg.platform || cfg.expect === "ub" ? "info" : "error", msg, diff: lineDiff(r0.stdout, r.stdout) });
        }
      }
    }
    // canonical answer for predict/quiz widgets = gcc (LP64 Linux), normalised
    const canon = rec.toolchains.gcc?.run ?? runs[0]?.[1];
    if (canon) rec.canonical = { stdout: canon.stdout, exitCode: canon.exitCode };
    results[cfg.id] = rec;
    rmSync(dir, { recursive: true, force: true });
  }
}

function checkExpect(cfg, name, t, issues) {
  const err = (msg) => issues.push({ level: "error", toolchain: name, msg });
  const warns = t.compile.diagnostics.filter((d) => d.severity === "warning");
  const e = cfg.expect;
  if (e === "compile-error") { if (t.compile.ok) err("expected a compile error but it compiled"); return; }
  if (!t.compile.ok) { err("unexpected compile failure:\n" + t.compile.stderr); return; }
  if (e === "warning") {
    if (!warns.length) err("expected a warning, got none");
    for (const w of cfg.warn) if (!warns.some((d) => d.flag === w)) err(`expected warning ${w}, got [${warns.map((d) => d.flag).join(", ")}]`);
  }
  const r = t.run;
  if (!r) return;
  if (r.timedOut) return err(`timed out after ${cfg.timeoutMs} ms`);
  if (e === "runtime-error") { if (r.exitCode === 0 && !r.signal) err("expected a runtime error / sanitizer report"); return; }
  if (e === "ub") return; // record whatever happens; outputs may legitimately differ
  const m = /^exit:(\d+)$/.exec(e);
  const want = m ? +m[1] : 0;
  if (r.exitCode !== want) err(`exit code ${r.exitCode ?? r.signal}, expected ${want}` + (r.stderr ? `\n${r.stderr}` : ""));
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), host: `${process.platform}-${process.arch}`, versions, samples: results }, null, 2));

// ---- friendly summary ----
let bad = 0;
for (const r of Object.values(results)) {
  const errs = r.issues.filter((i) => i.level === "error");
  bad += errs.length ? 1 : 0;
  const mark = errs.length ? "FAIL" : r.issues.length ? "note" : " ok ";
  console.log(`[${mark}] ${r.id.padEnd(22)} ${r.file}:${r.line}  expect=${r.expect}`);
  for (const i of r.issues) console.log(`        ${i.level}: ${i.toolchain ? i.toolchain + ": " : ""}${i.msg}${i.diff ? "\n" + i.diff.replace(/^/gm, "          ") : ""}`);
}
for (const p of problems) console.log(`[FAIL] ${p}`);
console.log(`\n${Object.keys(results).length} samples, ${bad + problems.length} failing -> ${outFile}`);
process.exit(bad + problems.length ? 1 : 0);
