// Per-sample result cache (.cache/verify/<key>.json). The key covers everything that can change a
// result: code, meta, compiler versions, the verifier's own source, the runtime support files the
// browser links (src/runtime/c/*, flags, compile-core, wasi-run) and the shipped toolchain manifest.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../shared/wasm-node';

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

function filesUnder(dir: string, keep: (f: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'fixtures' || e.name === 'node_modules' ? [] : filesUnder(p, keep);
    return keep(p) ? [p] : [];
  }).sort();
}

/** Hash of the code that produces results: verifier, tracer, shared tools, browser runtime, toolchain. */
export function environmentFingerprint(): string {
  const isSource = (f: string) => /\.(ts|mjs|py|c|h)$/.test(f) && !/\.test\.ts$/.test(f);
  const files = [
    ...filesUnder(path.join(ROOT, 'tools/verify'), isSource),
    ...filesUnder(path.join(ROOT, 'tools/trace'), isSource),
    ...filesUnder(path.join(ROOT, 'tools/shared'), isSource),
    ...filesUnder(path.join(ROOT, 'src/runtime/c'), () => true),
    ...['flags.ts', 'compile-core.ts', 'wasi-run.ts'].map(f => path.join(ROOT, 'src/runtime', f)),
  ];
  const h = createHash('sha256');
  for (const f of files) h.update(path.relative(ROOT, f)).update('\0').update(readFileSync(f)).update('\0');
  const versionFile = path.join(ROOT, 'src/generated/toolchain-version.json');
  if (existsSync(versionFile)) {
    const { version } = JSON.parse(readFileSync(versionFile, 'utf8')) as { version: string };
    const manifest = path.join(ROOT, 'public/toolchain', `clang-${version}`, 'manifest.json');
    h.update(existsSync(manifest) ? readFileSync(manifest) : version);
  }
  return h.digest('hex');
}

export class ResultCache<T> {
  private read: boolean;
  private write: boolean;

  /** `read: false` (--force) recomputes everything but still refreshes the cache. */
  constructor(private dir: string, o: { read?: boolean; write?: boolean } = {}) {
    this.read = o.read ?? true;
    this.write = o.write ?? true;
    if (this.write) mkdirSync(dir, { recursive: true });
  }

  static key(parts: unknown): string {
    return sha(JSON.stringify(parts));
  }

  get(key: string): T | undefined {
    if (!this.read) return undefined;
    const f = path.join(this.dir, `${key}.json`);
    if (!existsSync(f)) return undefined;
    try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return undefined; }
  }

  set(key: string, value: T): void {
    if (!this.write) return;
    writeFileSync(path.join(this.dir, `${key}.json`), JSON.stringify(value));
  }
}
