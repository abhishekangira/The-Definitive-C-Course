// `node check.mjs --doctor`: the environment report of lesson 3.1 (issue #73, infrastructure C). It prints
// what this machine has for the course (arch, OS, compiler, Node, debuggers and memory tools, the sizeof
// table of a compiled program, cache-line and page size) and which "my machine" value to pick in the
// course. Exit status: 0 usable (notes are fine), 1 no compiler or too old a Node. A value it cannot
// read prints as "unknown", never as 0.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Platform } from '../../../src/progress/store';
import { findCompiler, NativeBackend, sh, type Capabilities, type Compiler } from './native-backend';

export const MIN_NODE = 18;
const TOOLS = ['gdb', 'lldb', 'valgrind', 'leaks'] as const;
type Tool = typeof TOOLS[number];
export const SIZEOF_TYPES = ['char', 'short', 'int', 'long', 'long long', 'float', 'double', 'long double', 'void *', 'size_t'];

export interface DoctorFacts {
  /** process.platform, or CHECK_PLATFORM. */
  platform: string;
  /** The architecture Node was built for (process.arch). */
  nodeArch: string;
  nodeVersion: string;
  /** `uname -m`. */
  machine?: string;
  /** macOS: the hardware is an Apple chip (hw.optional.arm64), whatever this process runs as. */
  appleSilicon?: boolean;
  /** macOS: this process runs under Rosetta (sysctl.proc_translated). */
  translated?: boolean;
  wsl: boolean;
  os?: string;
  compiler?: Compiler;
  tools: Record<Tool, boolean>;
  memory?: Capabilities;
  sizes: Record<string, number | undefined>;
  cacheLine?: number;
  pageSize?: number;
}

export interface Finding {
  level: 'error' | 'warning' | 'note';
  text: string;
  remedy?: string;
}

export interface Assessment {
  machine?: Platform;
  findings: Finding[];
  ok: boolean;
}

const positive = (s: string | undefined): number | undefined => {
  const n = Number((s ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
const out = (cmd: string, args: string[]): string | undefined => {
  const r = sh(cmd, args, { timeout: 10_000 });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : undefined;
};
const sysctl = (key: string) => out('sysctl', ['-n', key]);
const flag = (s: string | undefined) => (s === '1' ? true : s === '0' ? false : undefined);
const onPath = (cmd: string) => (process.env.PATH ?? '').split(path.delimiter).some(d => d && existsSync(path.join(d, cmd)));
const readText = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return undefined; } };

/** Compiles and runs a small program that prints the size of each type. Unreadable sizes stay undefined. */
function measureSizes(compiler: Compiler | undefined): Record<string, number | undefined> {
  const sizes: Record<string, number | undefined> = Object.fromEntries(SIZEOF_TYPES.map(t => [t, undefined]));
  if (!compiler) return sizes;
  const dir = mkdtempSync(path.join(tmpdir(), 'doctor-'));
  try {
    const lines = SIZEOF_TYPES.map(t => `  printf("${t}=%zu\\n", sizeof(${t}));`);
    writeFileSync(path.join(dir, 'sizes.c'), `#include <stdio.h>\n#include <stddef.h>\nint main(void) {\n${lines.join('\n')}\n  return 0;\n}\n`);
    const exe = path.join(dir, 'sizes');
    const b = sh(compiler.cc, ['-std=c17', path.join(dir, 'sizes.c'), '-o', exe], { timeout: 60_000, env: { ...process.env, LC_ALL: 'C' } });
    const r = b.status === 0 ? sh(exe, [], { timeout: 10_000 }) : undefined;
    for (const m of (r?.status === 0 ? r.stdout : '').matchAll(/^(.+)=(\d+)$/gm)) if (m[1] in sizes) sizes[m[1]] = positive(m[2]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return sizes;
}

export function gatherFacts(opts: { cc?: string; platform: string; noSanitizers: boolean }): DoctorFacts {
  const mac = opts.platform === 'darwin';
  const compiler = findCompiler(opts.cc);
  let memory: Capabilities | undefined;
  if (compiler) {
    const backend = new NativeBackend(compiler, { dir: tmpdir(), platform: opts.platform, noSanitizers: opts.noSanitizers });
    try { memory = backend.capabilities(); } finally { backend.dispose(); }
  }
  const osRelease = mac ? undefined : readText('/etc/os-release');
  const macVersion = mac ? out('sw_vers', ['-productVersion']) : undefined;
  const linuxCache = readText('/sys/devices/system/cpu/cpu0/cache/index0/coherency_line_size');
  return {
    platform: opts.platform,
    nodeArch: process.arch,
    nodeVersion: process.versions.node,
    machine: out('uname', ['-m']),
    appleSilicon: mac ? flag(sysctl('hw.optional.arm64')) : undefined,
    translated: mac ? flag(sysctl('sysctl.proc_translated')) : undefined,
    wsl: !mac && (!!process.env.WSL_DISTRO_NAME || /microsoft|wsl/i.test(readText('/proc/sys/kernel/osrelease') ?? '')),
    os: mac ? (macVersion ? `macOS ${macVersion}` : undefined) : /^PRETTY_NAME="?([^"\n]+)"?$/m.exec(osRelease ?? '')?.[1],
    compiler,
    tools: Object.fromEntries(TOOLS.map(t => [t, onPath(t)])) as Record<Tool, boolean>,
    memory,
    sizes: measureSizes(compiler),
    cacheLine: mac ? positive(sysctl('hw.cachelinesize')) : positive(out('getconf', ['LEVEL1_DCACHE_LINESIZE'])) ?? positive(linuxCache),
    pageSize: mac ? positive(sysctl('hw.pagesize')) : positive(out('getconf', ['PAGESIZE'])),
  };
}

/** What the facts mean: the "my machine" value, and the problems (errors fail the doctor; notes don't). */
export function assess(f: DoctorFacts): Assessment {
  const findings: Finding[] = [];
  const mac = f.platform === 'darwin';
  const arm = (s?: string) => s === 'arm64' || s === 'aarch64';
  const major = Number.parseInt(f.nodeVersion, 10);
  if (!(major >= MIN_NODE)) {
    findings.push({ level: 'error', text: `Node ${f.nodeVersion} is too old: the course's tools need Node ${MIN_NODE} or newer.`,
      remedy: mac ? 'Install the current LTS from https://nodejs.org (the macOS installer), then open a new terminal.'
        : 'Install the current LTS from https://nodejs.org, or on Ubuntu / WSL: sudo apt install nodejs' });
  } else if (major === MIN_NODE) {
    findings.push({ level: 'note', text: `Node ${MIN_NODE} works but is past end of life; any newer LTS works too.` });
  }
  if (!f.compiler) {
    findings.push({ level: 'error', text: 'No C compiler found (tried $CC, cc, clang and gcc).',
      remedy: mac ? 'Install the Xcode Command Line Tools:  xcode-select --install' : 'Install one:  sudo apt install build-essential   (Ubuntu / WSL)' });
  }

  let machine: Platform | undefined;
  if (mac) {
    const silicon = f.appleSilicon ?? (f.translated ? true : arm(f.nodeArch) ? true : undefined);
    machine = silicon === true ? 'mac-arm' : silicon === false ? 'mac-intel' : undefined;
    if (silicon && !arm(f.nodeArch)) {
      findings.push({ level: 'warning', text: `This Mac has an Apple chip, but Node runs as ${f.nodeArch} under Rosetta, so programs you build here may be x86_64 too.`,
        remedy: 'Install the arm64 Node (the macOS installer from https://nodejs.org), and if Terminal is set to "Open using Rosetta" (Finder, Get Info), turn that off. Then node -p process.arch prints arm64.' });
    } else if (silicon === undefined) {
      findings.push({ level: 'note', text: `Node is ${f.nodeArch} and the chip could not be read. If this Mac has an Apple chip (Apple menu, About This Mac), choose mac-arm and check that Terminal does not open using Rosetta; otherwise choose mac-intel.` });
    }
    if (!f.tools.lldb) findings.push({ level: 'note', text: 'lldb (the macOS debugger) was not found.', remedy: 'xcode-select --install' });
    if (!f.tools.leaks) findings.push({ level: 'note', text: 'leaks (the macOS leak checker) was not found.', remedy: 'xcode-select --install' });
  } else if (f.platform === 'linux') {
    const hw = f.machine ?? f.nodeArch;
    machine = f.wsl ? 'wsl' : arm(hw) ? 'linux-arm' : hw === 'x86_64' || hw === 'x64' ? 'linux-x86' : undefined;
    if (!f.tools.gdb) findings.push({ level: 'note', text: 'gdb (the debugger used in Linux and WSL lessons) was not found.', remedy: 'sudo apt install gdb' });
    if (!f.tools.valgrind) findings.push({ level: 'note', text: 'Valgrind was not found.', remedy: 'sudo apt install valgrind' });
  } else {
    findings.push({ level: 'note', text: `The course's native lessons run on macOS, Linux and WSL, not on ${f.platform}.`, remedy: 'On Windows, run this inside WSL (Ubuntu).' });
  }
  if (f.compiler && f.memory && !f.memory.sanitizers && !f.memory.valgrind) {
    findings.push({ level: 'note', text: `No memory checker works here: ${f.compiler.cc} has no sanitizer runtime${mac ? '' : ' and Valgrind is not installed'}.`,
      remedy: mac ? 'Use Apple clang (xcode-select --install) as cc.' : 'sudo apt install valgrind (or a gcc with libasan: sudo apt install build-essential)' });
  }
  return { machine, findings, ok: !findings.some(x => x.level === 'error') };
}

const unknown = (v: number | string | undefined, unit = '') => (v === undefined ? 'unknown' : `${v}${unit}`);
const bytes = (n: number | undefined) => (n === undefined ? 'unknown' : n % 1024 === 0 ? `${n} B (${n / 1024} KiB)` : `${n} B`);

function memoryLine(f: DoctorFacts): string {
  const m = f.memory;
  if (!m) return 'unknown (no compiler)';
  const parts: string[] = [];
  if (m.sanitizers) parts.push(f.platform === 'linux' ? `ASan + UBSan${m.lsan ? ' + LeakSanitizer' : ' (LeakSanitizer does not work here)'}` : 'ASan + UBSan');
  if (m.valgrind) parts.push(m.sanitizers ? 'Valgrind' : 'Valgrind (no sanitizer runtime)');
  if (m.leaks) parts.push('leaks');
  return parts.length ? parts.join(', ') : 'none';
}

export function formatDoctor(f: DoctorFacts, a: Assessment, mark: { pass: string; fail: string }): string[] {
  const row = (k: string, v: string) => `  ${k.padEnd(18)}${v}`;
  const has = (t: Tool) => (f.tools[t] ? 'yes' : 'no');
  const arch = f.translated ? `${unknown(f.machine)} (Node: ${f.nodeArch}, under Rosetta)` : `${unknown(f.machine)} (Node: ${f.nodeArch})`;
  const lines = [
    row('Architecture', arch),
    row('Operating system', `${unknown(f.os)}${f.wsl ? ' (WSL)' : ''}`),
    row('C compiler', f.compiler ? `${f.compiler.cc}: ${f.compiler.version}` : 'none found'),
    row('Node', `v${f.nodeVersion}`),
    row('Debuggers', `gdb ${has('gdb')}, lldb ${has('lldb')}`),
    row('Memory tools', `Valgrind ${has('valgrind')}, leaks ${has('leaks')}`),
    row('Memory checks', memoryLine(f)),
    row('Cache line', bytes(f.cacheLine)),
    row('Page size', bytes(f.pageSize)),
    '',
    f.compiler ? `  sizeof (bytes, from a program built with ${f.compiler.cc}):` : '  sizeof (bytes; needs a C compiler):',
    ...SIZEOF_TYPES.map(t => row(`    ${t}`, unknown(f.sizes[t]))),
    '',
    `"My machine" in the course: ${a.machine ?? 'unknown'}`,
  ];
  for (const x of a.findings) {
    lines.push('', `${x.level === 'error' ? mark.fail : x.level === 'warning' ? '!' : '-'} ${x.level === 'note' ? 'Note: ' : ''}${x.text}`);
    if (x.remedy) lines.push(`    ${x.remedy}`);
  }
  lines.push('', a.ok ? `${mark.pass} This machine is ready for the course's native lessons.` : `${mark.fail} Not ready yet: see above.`);
  return lines;
}
