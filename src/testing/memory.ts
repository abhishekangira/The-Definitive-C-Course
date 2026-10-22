// Memory-error reports → plain-English issues. Environment-neutral (pure string parsing):
//   - browser: JSON events written by src/runtime/c/leakcheck.c (LeakEvent);
//   - native: AddressSanitizer / LeakSanitizer / UBSan stderr, valgrind stderr, macOS `leaks --atExit` stdout.
// The parsers were written against real reports from gcc 13, clang 22 and valgrind 3.22 (see memory.test.ts).
import type { LeakEvent } from '../runtime/protocol';

export type MemoryTool = 'leakcheck' | 'asan' | 'lsan' | 'ubsan' | 'valgrind' | 'leaks';

export type MemoryIssueKind =
  | 'leak'
  | 'heap-overflow'
  | 'stack-buffer-overflow'
  | 'global-buffer-overflow'
  | 'use-after-free'
  | 'use-after-return'
  | 'double-free'
  | 'invalid-free'
  | 'invalid-realloc'
  | 'stack-overflow'
  | 'segv'
  | 'uninitialised'
  | 'undefined-behaviour'
  | 'other';

export interface MemoryIssue {
  kind: MemoryIssueKind;
  tool: MemoryTool;
  /** One plain-English sentence, e.g. "memory leak: 12 bytes allocated at main.c:14 were never freed". */
  message: string;
  /** Where the problem happened (the leaking allocation for leaks), when a learner frame is known. */
  file?: string;
  line?: number;
  bytes?: number;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const at = (file?: string, line?: number) => (file ? `${file}:${line ?? '?'}` : 'an unknown location');
const basename = (p: string) => p.replace(/^.*[\\/]/, '');

// ---------------------------------------------------------------- browser leak checker

/**
 * Converts leakcheck.c events. Several leaks from the same allocation site (for example one per loop
 * iteration) are merged into one issue.
 */
export function leakEventsToIssues(events: readonly LeakEvent[]): MemoryIssue[] {
  const out: MemoryIssue[] = [];
  const leaks = new Map<string, { file: string; line: number; bytes: number; blocks: number }>();
  for (const e of events) {
    const file = e.file || undefined;
    const line = e.line || undefined;
    switch (e.type) {
      case 'leak': {
        const key = `${e.file}:${e.line}`;
        const l = leaks.get(key) ?? { file: e.file, line: e.line, bytes: 0, blocks: 0 };
        l.bytes += e.bytes;
        l.blocks += 1;
        leaks.set(key, l);
        break;
      }
      case 'overflow':
        out.push({ kind: 'heap-overflow', tool: 'leakcheck', file, line, bytes: e.bytes,
          message: `heap overflow: wrote past the end of a ${e.bytes}-byte block allocated at ${at(file, line)}` });
        break;
      case 'invalid-free':
        out.push({ kind: 'invalid-free', tool: 'leakcheck', file, line,
          message: file ? `invalid free at ${at(file, line)} (double free?)` : 'invalid free of a pointer that malloc did not return (double free?)' });
        break;
      case 'invalid-realloc':
        out.push({ kind: 'invalid-realloc', tool: 'leakcheck', file, line,
          message: `invalid realloc at ${at(file, line)}: the pointer did not come from malloc, or was already freed` });
        break;
    }
  }
  for (const l of leaks.values()) {
    const what = l.blocks > 1 ? `${plural(l.blocks, 'block')} (${plural(l.bytes, 'byte')})` : plural(l.bytes, 'byte');
    out.push({ kind: 'leak', tool: 'leakcheck', file: l.file || undefined, line: l.line || undefined, bytes: l.bytes,
      message: `memory leak: ${what} allocated at ${at(l.file || undefined, l.line || undefined)} ${l.blocks === 1 && l.bytes === 1 ? 'was' : 'were'} never freed` });
  }
  return out;
}

// ---------------------------------------------------------------- frames

interface Frame { func: string; file: string; line: number }

/** Decides which stack frames belong to the learner (by basename), with a heuristic fallback. */
function makeLearnerFilter(sources: readonly string[]): (f: Frame) => boolean {
  const names = new Set(sources.map(basename));
  if (names.size) return f => names.has(basename(f.file));
  return f => /\.[ch]$/.test(f.file) && !/(^|[\\/])(\.\.|usr|csu|sysdeps)[\\/]|libsanitizer|compiler-rt/.test(f.file);
}

/** ASan/LSan frame: "#1 0x5565c69b42be in main /abs/overflow.c:4" or "...overflow.c:4:15". */
const ASAN_FRAME = /^\s*#\d+ 0x[0-9a-f]+ in (\S+) (.+?):(\d+)(?::\d+)?\s*$/;

function asanFrames(lines: string[]): Frame[] {
  const out: Frame[] = [];
  for (const l of lines) {
    const m = ASAN_FRAME.exec(l);
    if (m) out.push({ func: m[1], file: m[2], line: Number(m[3]) });
  }
  return out;
}

/** Splits an ASan report into the stack after the header and the labelled stacks ("freed by thread T0 here:"). */
function asanSections(report: string): { main: string[]; allocated: string[]; freed: string[] } {
  const sections = { main: [] as string[], allocated: [] as string[], freed: [] as string[] };
  let cur: string[] = sections.main;
  for (const l of report.split('\n')) {
    if (/^(previously )?allocated by thread/.test(l)) cur = sections.allocated;
    else if (/^freed by thread/.test(l)) cur = sections.freed;
    else if (/^(SUMMARY|Shadow bytes)/.test(l)) cur = [];
    else if (/^Address .* is located in stack|is located \d+ bytes/.test(l)) cur = [];
    cur.push(l);
  }
  return sections;
}

function firstLearner(frames: Frame[], isLearner: (f: Frame) => boolean): Frame | undefined {
  return frames.find(isLearner);
}

const where = (f?: Frame) => (f ? `${basename(f.file)}:${f.line}` : undefined);

/** "0 bytes after" → "just past the end of"; "3 bytes before" → "3 bytes before the start of". */
function relation(offset: number, rel: string): string {
  if (/after|right/.test(rel)) return offset === 0 ? 'just past the end of' : `${plural(offset, 'byte')} past the end of`;
  if (/before|left/.test(rel)) return `${plural(offset, 'byte')} before the start of`;
  return 'inside';
}

// ---------------------------------------------------------------- AddressSanitizer / LeakSanitizer / UBSan

/**
 * Parses native sanitizer output from stderr. `sources` are the learner's file names; frames in those
 * files are used for locations. Returns [] when there is no report.
 */
export function parseSanitizerReport(stderr: string, sources: readonly string[] = []): MemoryIssue[] {
  const isLearner = makeLearnerFilter(sources);
  const issues: MemoryIssue[] = [];

  // UBSan (also printed by ASan+UBSan builds): "ub.c:5:7: runtime error: signed integer overflow: …"
  for (const m of stderr.matchAll(/^(?:.*[\\/])?([^\\/\n:]+):(\d+):\d+: runtime error: (.*)$/gm)) {
    issues.push({ kind: 'undefined-behaviour', tool: 'ubsan', file: m[1], line: Number(m[2]),
      message: `undefined behaviour at ${m[1]}:${m[2]}: ${m[3]}` });
  }

  const head = /==\d+==ERROR: (AddressSanitizer|LeakSanitizer): (.*)$/m.exec(stderr);
  if (!head) return issues;
  const report = stderr.slice(head.index);

  if (head[1] === 'LeakSanitizer' || /detected memory leaks/.test(head[2])) {
    const sites = new Map<string, MemoryIssue & { blocks: number }>();
    const blocks = report.split(/\n(?=(?:Direct|Indirect) leak of )/);
    for (const b of blocks) {
      const m = /^(Direct|Indirect) leak of (\d+) byte\(s\) in (\d+) object\(s\) allocated from:/m.exec(b);
      if (!m) continue;
      const f = firstLearner(asanFrames(b.split('\n')), isLearner);
      const key = `${m[1]}|${where(f)}`;
      const prev = sites.get(key);
      const bytes = Number(m[2]) + (prev?.bytes ?? 0);
      const count = Number(m[3]) + (prev?.blocks ?? 0);
      const indirect = m[1] === 'Indirect' ? ' (it was only reachable through another leaked block)' : '';
      sites.set(key, {
        kind: 'leak', tool: 'lsan', file: f && basename(f.file), line: f?.line, bytes, blocks: count,
        message: `memory leak: ${count > 1 ? `${plural(count, 'block')} (${plural(bytes, 'byte')})` : plural(bytes, 'byte')} allocated at ${where(f) ?? 'an unknown location'} ${bytes === 1 ? 'was' : 'were'} never freed${indirect}`,
      });
    }
    // Direct leaks first: fixing those usually fixes the indirect ones.
    const all = [...sites.values()].sort((a, b) => Number(/reachable/.test(a.message)) - Number(/reachable/.test(b.message)));
    for (const { blocks: _blocks, ...issue } of all) issues.push(issue);
    return issues;
  }

  const type = head[2].split(' ')[0];
  const sec = asanSections(report);
  const site = firstLearner(asanFrames(sec.main), isLearner);
  const alloc = where(firstLearner(asanFrames(sec.allocated), isLearner));
  const freed = where(firstLearner(asanFrames(sec.freed), isLearner));
  const access = /^(READ|WRITE) of size (\d+)/m.exec(report);
  const verb = access ? `${access[1] === 'WRITE' ? 'wrote' : 'read'} ${plural(Number(access[2]), 'byte')}` : 'accessed memory';
  const region = /is located (\d+) bytes (after|before|to the right of|to the left of|inside of) (\d+)-byte region/.exec(report);
  const stackVar = /\[\d+, \d+\) '([^']+)' \(line (\d+)\) <== Memory access at offset \d+ (overflows|underflows|partially overflows|is inside) this variable/.exec(report);
  const globalVar = /is located (\d+) bytes (after|before|to the right of|to the left of) global variable '([^']+)'/.exec(report);
  const loc = where(site);
  const base = { tool: 'asan' as const, file: site && basename(site.file), line: site?.line };

  switch (true) {
    case type === 'heap-buffer-overflow': {
      const rel = region ? `${relation(Number(region[1]), region[2])} a ${region[3]}-byte block` : 'outside a heap block';
      issues.push({ ...base, kind: 'heap-overflow', bytes: region ? Number(region[3]) : undefined,
        message: `heap overflow at ${loc ?? 'an unknown location'}: ${verb} ${rel}${alloc ? ` allocated at ${alloc}` : ''}` });
      break;
    }
    case type === 'heap-use-after-free': {
      const size = region ? ` ${region[3]}-byte` : '';
      issues.push({ ...base, kind: 'use-after-free',
        message: `use after free at ${loc ?? 'an unknown location'}: ${verb} ${access?.[1] === 'WRITE' ? 'into' : 'from'} a${size} block that was already freed${freed ? ` at ${freed}` : ''}${alloc ? ` (allocated at ${alloc})` : ''}` });
      break;
    }
    case type === 'attempting' && /double-free/.test(head[2]): {
      const size = region ? ` ${region[3]}-byte` : '';
      issues.push({ ...base, kind: 'double-free',
        message: `double free at ${loc ?? 'an unknown location'}: this${size} block was already freed${freed ? ` at ${freed}` : ''}${alloc ? ` (allocated at ${alloc})` : ''}` });
      break;
    }
    case type === 'attempting': {
      const what = stackVar ? ` (it points to the local variable '${stackVar[1]}')` : '';
      issues.push({ ...base, kind: 'invalid-free',
        message: `invalid free at ${loc ?? 'an unknown location'}: that pointer did not come from malloc${what}` });
      break;
    }
    case type === 'stack-buffer-overflow' || type === 'stack-buffer-underflow': {
      const v = stackVar ? `the local variable '${stackVar[1]}' (declared on line ${stackVar[2]})` : 'a local variable';
      const dir = stackVar && /under/.test(stackVar[3]) ? 'before the start of' : 'past the end of';
      issues.push({ ...base, kind: 'stack-buffer-overflow', message: `stack buffer overflow at ${loc ?? 'an unknown location'}: ${verb} ${dir} ${v}` });
      break;
    }
    case type === 'global-buffer-overflow': {
      const v = globalVar ? `the global variable '${globalVar[3]}'` : 'a global variable';
      const dir = globalVar && /before|left/.test(globalVar[2]) ? 'before the start of' : 'past the end of';
      issues.push({ ...base, kind: 'global-buffer-overflow', message: `global buffer overflow at ${loc ?? 'an unknown location'}: ${verb} ${dir} ${v}` });
      break;
    }
    case type === 'stack-use-after-return' || type === 'stack-use-after-scope': {
      issues.push({ ...base, kind: 'use-after-return',
        message: `use of a local variable after ${type.endsWith('return') ? 'its function returned' : 'its block ended'} at ${loc ?? 'an unknown location'}` });
      break;
    }
    case type === 'stack-overflow': {
      issues.push({ ...base, kind: 'stack-overflow',
        message: `stack overflow${site ? ` in ${site.func}() at ${loc}` : ''}: the call stack ran out, usually because of infinite or very deep recursion` });
      break;
    }
    case type === 'SEGV': {
      const rw = /The signal is caused by a (READ|WRITE) memory access/.exec(report)?.[1];
      const nul = /address points to the zero page|unknown address 0x0+ /.test(report);
      const what = nul ? `${rw === 'WRITE' ? 'wrote' : 'read'} through a NULL pointer` : `${rw === 'WRITE' ? 'wrote to' : rw === 'READ' ? 'read from' : 'touched'} memory it does not own (a wild or dangling pointer?)`;
      issues.push({ ...base, kind: 'segv', message: `segmentation fault at ${loc ?? 'an unknown location'}: ${what}` });
      break;
    }
    default:
      issues.push({ ...base, kind: 'other', message: `${head[2].replace(/ on (unknown )?address.*$/, '')}${loc ? ` at ${loc}` : ''}` });
  }
  return issues;
}

// ---------------------------------------------------------------- valgrind (memcheck)

/** Valgrind frame: "at 0x1091C6: main (overflow.c:6)" or "by 0x...: malloc (in /usr/lib/...)". */
const VG_FRAME = /^\s+(?:at|by) 0x[0-9A-Fa-f]+: (\S+) \(([^():]+):(\d+)\)\s*$/;

/** Parses `valgrind --leak-check=full` stderr into issues (errors first, then leaks). */
export function parseValgrindReport(stderr: string, sources: readonly string[] = []): MemoryIssue[] {
  const isLearner = makeLearnerFilter(sources);
  const lines = stderr.split('\n').filter(l => /^==\d+==/.test(l)).map(l => l.replace(/^==\d+== ?/, ''));
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (l.trim() === '') { if (cur.length) blocks.push(cur); cur = []; }
    else cur.push(l);
  }
  if (cur.length) blocks.push(cur);

  const issues: MemoryIssue[] = [];
  const leaks: MemoryIssue[] = [];
  for (const b of blocks) {
    const header = b[0];
    // The first stack is the site; "Address … alloc'd/free'd" and "Block was alloc'd at" stacks follow.
    const stacks: Frame[][] = [[]];
    const notes: string[] = [];
    for (const l of b.slice(1)) {
      const m = VG_FRAME.exec(l);
      if (m) stacks[stacks.length - 1].push({ func: m[1], file: m[2], line: Number(m[3]) });
      else if (/^\s+at 0x|^\s+by 0x/.test(l)) continue; // frame without source info
      else { notes.push(l.trim()); stacks.push([]); }
    }
    // "Process terminating…" puts its stack after the "Access not within mapped region" note.
    const site = firstLearner(stacks[0], isLearner) ?? (/^Process terminating/.test(header) ? firstLearner(stacks.flat(), isLearner) : undefined);
    const loc = where(site) ?? 'an unknown location';
    const base = { tool: 'valgrind' as const, file: site && basename(site.file), line: site?.line };
    const addr = notes.find(n => n.startsWith('Address')) ?? '';
    const addrIdx = notes.indexOf(addr);
    const second = addrIdx >= 0 ? where(firstLearner(stacks[addrIdx + 1] ?? [], isLearner)) : undefined;
    const allocIdx = notes.findIndex(n => /^Block was alloc'd at/.test(n));
    const allocAt = allocIdx >= 0 ? where(firstLearner(stacks[allocIdx + 1] ?? [], isLearner)) : undefined;
    let m: RegExpExecArray | null;

    if ((m = /^Invalid (read|write) of size (\d+)/.exec(header))) {
      const verb = `${m[1] === 'write' ? 'wrote' : 'read'} ${plural(Number(m[2]), 'byte')}`;
      let a: RegExpExecArray | null;
      if ((a = /is (\d+) bytes (after|before) a block of size (\d+) alloc'd/.exec(addr))) {
        issues.push({ ...base, kind: 'heap-overflow', bytes: Number(a[3]),
          message: `heap overflow at ${loc}: ${verb} ${relation(Number(a[1]), a[2])} a ${a[3]}-byte block${second ? ` allocated at ${second}` : ''}` });
      } else if ((a = /inside a block of size (\d+) free'd/.exec(addr))) {
        issues.push({ ...base, kind: 'use-after-free',
          message: `use after free at ${loc}: ${verb} ${m[1] === 'write' ? 'into' : 'from'} a ${a[1]}-byte block that was already freed${second ? ` at ${second}` : ''}${allocAt ? ` (allocated at ${allocAt})` : ''}` });
      } else if (/Address 0x0 is not stack'd/.test(addr)) {
        issues.push({ ...base, kind: 'segv', message: `invalid ${m[1]} at ${loc}: through a NULL pointer` });
      } else {
        issues.push({ ...base, kind: 'other', message: `invalid ${m[1]} of ${plural(Number(m[2]), 'byte')} at ${loc}: memory the program does not own` });
      }
    } else if (/^Invalid free\(\)/.test(header)) {
      if (/inside a block of size (\d+) free'd/.test(addr)) {
        issues.push({ ...base, kind: 'double-free',
          message: `double free at ${loc}: this block was already freed${second ? ` at ${second}` : ''}${allocAt ? ` (allocated at ${allocAt})` : ''}` });
      } else {
        const stack = /on thread \d+'s stack/.test(addr) ? ' (it points into the stack)' : '';
        issues.push({ ...base, kind: 'invalid-free', message: `invalid free at ${loc}: that pointer did not come from malloc${stack}` });
      }
    } else if ((m = /^(\d[\d,]*) (?:\((\d[\d,]*) direct, \d[\d,]* indirect\) )?bytes in (\d[\d,]*) blocks are (definitely|indirectly|possibly) lost/.exec(header))) {
      const num = (s: string) => Number(s.replace(/,/g, ''));
      const bytes = num(m[2] ?? m[1]);
      const blocks = num(m[3]);
      const what = blocks > 1 ? `${plural(blocks, 'block')} (${plural(bytes, 'byte')})` : plural(bytes, 'byte');
      const indirect = m[4] === 'indirectly' ? ' (it was only reachable through another leaked block)' : '';
      leaks.push({ ...base, kind: 'leak', bytes,
        message: `memory leak: ${what} allocated at ${loc} ${bytes === 1 ? 'was' : 'were'} never freed${indirect}` });
    } else if (/uninitialised/.test(header)) {
      issues.push({ ...base, kind: 'uninitialised', message: `used an uninitialised value at ${loc} (${header.replace(/\s*\(s\)/, 's').toLowerCase()})` });
    } else if (/^Process terminating with default action of signal \d+ \((SIG\w+)\)/.test(header)) {
      const sig = /\((SIG\w+)\)/.exec(header)![1];
      const nul = notes.some(n => /address 0x0\b/.test(n));
      issues.push({ ...base, kind: sig === 'SIGSEGV' ? 'segv' : 'other',
        message: `${sig === 'SIGSEGV' ? 'segmentation fault' : `crashed with ${sig}`} at ${loc}${nul ? ': through a NULL pointer' : ''}` });
    } else if (/^(Mismatched free|Source and destination overlap|Argument .* of function .* has a fishy)/.test(header)) {
      issues.push({ ...base, kind: 'other', message: `${header.replace(/\s+$/, '')} at ${loc}` });
    }
  }
  // Direct leaks before indirect ones.
  leaks.sort((a, b) => Number(/reachable/.test(a.message)) - Number(/reachable/.test(b.message)));
  return [...issues, ...leaks];
}

// ---------------------------------------------------------------- macOS leaks(1)

/**
 * Parses `leaks --atExit -- ./prog` output (macOS). The summary line is "Process 123: 2 leaks for 32 total leaked bytes.".
 * Verified on real macOS: the `project-runner (macos-14, caesar)` job in targets.yml parses real `leaks` output on every run.
 * Returns undefined when that summary line is missing: `leaks` did not report, which is not the same as "0 leaks".
 */
export function parseLeaksReport(stdout: string, sources: readonly string[] = []): MemoryIssue[] | undefined {
  const m = /(\d+) leaks? for (\d+) total leaked bytes/.exec(stdout);
  if (!m) return undefined;
  if (Number(m[1]) === 0) return [];
  const names = sources.map(basename).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = names.length ? new RegExp(`(${names.join('|')}):(\\d+)`) : /([\w.-]+\.[ch]):(\d+)/;
  const loc = re.exec(stdout.slice(m.index));
  const blocks = Number(m[1]);
  const bytes = Number(m[2]);
  return [{
    kind: 'leak', tool: 'leaks', bytes, file: loc?.[1], line: loc ? Number(loc[2]) : undefined,
    message: `memory leak: ${plural(blocks, 'block')} (${plural(bytes, 'byte')}) never freed${loc ? ` (allocated at ${loc[1]}:${loc[2]})` : ''}`,
  }];
}

// ---------------------------------------------------------------- helpers

/** Removes repeated issues (the same kind at the same place) across several runs. */
export function dedupeIssues(issues: readonly MemoryIssue[]): MemoryIssue[] {
  const seen = new Set<string>();
  return issues.filter(i => {
    const key = `${i.kind}|${i.file ?? ''}|${i.line ?? ''}|${i.kind === 'leak' || i.file ? '' : i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
