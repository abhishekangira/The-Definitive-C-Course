import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ToolchainState } from '../runtime/CRuntime';
import { toolchainView } from '../components/toolchain-view';
import { classifyLoadFailure, createToolchainFetch, describeLoadFailure, loadToolchain, patchBundleSource, ToolchainCorruptError, ToolchainDownloadError, ToolchainLoadError } from './toolchain-cache';

const BASE = new URL('https://example.test/toolchain/clang-1/');
const url = (name: string) => new URL(name, BASE).href;

/** The part of the Cache API the code uses. `put` reads the whole body, like the real one, and can be held back by the test. */
class FakeCache {
  entries = new Map<string, Uint8Array>();
  gate: Promise<void> | null = null;
  async match(u: string) { const b = this.entries.get(u); return b ? new Response(b as BodyInit) : undefined; }
  async put(u: string, r: Response) {
    const bytes = new Uint8Array(await r.arrayBuffer()); // rejects if the body errors: nothing is stored
    await this.gate;
    this.entries.set(u, bytes);
  }
  async delete(u: string) { return this.entries.delete(u); }
}
function setup(netFiles: Record<string, () => Response>) {
  const cache = new FakeCache();
  const storage = { open: async () => cache } as unknown as CacheStorage;
  const requested: string[] = [];
  const realFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    requested.push(u);
    const make = netFiles[u.slice(BASE.href.length)];
    return make ? make() : new Response('', { status: 404 });
  }) as typeof fetch;
  return { cache, requested, tf: createToolchainFetch({ base: BASE, cacheName: 'c', fetch: realFetch, caches: storage }) };
}
const ok = (text: string) => () => new Response(text);
const deferred = () => { let release!: () => void; const p = new Promise<void>(r => (release = r)); return { p, release }; };

describe('createToolchainFetch', () => {
  it('serves a cached file without the network and counts it', async () => {
    const { cache, requested, tf } = setup({ 'a.wasm': ok('net') });
    cache.entries.set(url('a.wasm'), new TextEncoder().encode('cached'));
    expect(await (await tf.fetch(url('a.wasm'))).text()).toBe('cached');
    expect(requested).toEqual([]);
    expect(tf.stats).toEqual({ cacheHits: 1, networkFetches: 0 });
  });

  it('settled() waits for a cache.put that is still running', async () => {
    const { cache, tf } = setup({ 'a.wasm': ok('data') });
    const gate = deferred();
    cache.gate = gate.p;
    await (await tf.fetch(url('a.wasm'))).text();
    let done = false;
    const settled = tf.settled().then(() => { done = true; });
    await new Promise(r => setTimeout(r, 20));
    expect(done, 'still waiting for the put').toBe(false);
    expect(cache.entries.size).toBe(0);
    gate.release();
    await settled;
    expect(cache.entries.has(url('a.wasm'))).toBe(true);
  });

  it('never stores a body that fails halfway (a dropped connection)', async () => {
    const broken = () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); c.error(new TypeError('network error')); } }));
    const { cache, tf } = setup({ 'big.wasm': broken });
    await expect((await tf.fetch(url('big.wasm'))).arrayBuffer()).rejects.toThrow('network error');
    await tf.settled();
    expect(cache.entries.size).toBe(0);
  });

  it('discardAttempt() deletes what this attempt stored, even a put still in flight, and keeps earlier files', async () => {
    const { cache, tf } = setup({ 'new.wasm': ok('corrupt') });
    cache.entries.set(url('good.wasm'), new TextEncoder().encode('good'));
    tf.beginAttempt();
    await (await tf.fetch(url('good.wasm'))).text(); // a hit: not this attempt's to delete
    const gate = deferred();
    cache.gate = gate.p;
    await (await tf.fetch(url('new.wasm'))).text();
    const discarding = tf.discardAttempt('stored');
    gate.release(); // the put finishes only now; discardAttempt must still remove it
    await discarding;
    expect([...cache.entries.keys()]).toEqual([url('good.wasm')]);
  });

  it("discardAttempt('all') also deletes a corrupt file that was only read from the cache; 'stored' keeps it", async () => {
    for (const [scope, left] of [['stored', [url('bad.wasm')]], ['all', []]] as const) {
      const { cache, tf } = setup({});
      cache.entries.set(url('bad.wasm'), new Uint8Array([1, 2, 3]));
      tf.beginAttempt();
      await tf.fetch(url('bad.wasm'));
      await tf.discardAttempt(scope);
      expect([...cache.entries.keys()], scope).toEqual(left);
    }
  });

  it('does not touch files outside the toolchain URL', async () => {
    const { requested, cache, tf } = setup({});
    await tf.fetch('https://example.test/elsewhere.js');
    expect(requested).toEqual(['https://example.test/elsewhere.js']);
    expect(cache.entries.size).toBe(0);
  });
});

describe('classifyLoadFailure', () => {
  it.each([
    [new TypeError('Failed to fetch'), 'download'],
    [new ToolchainDownloadError('HTTP 404'), 'download'],
    [new TypeError('network error'), 'download'],
    [new TypeError("Failed to execute 'compile' on 'WebAssembly': Incorrect response MIME type. Expected 'application/wasm'."), 'corrupt'],
    [Object.assign(new Error('bad wasm'), { name: 'CompileError' }), 'corrupt'],
    [Object.assign(new Error('bad import'), { name: 'LinkError' }), 'corrupt'],
    [new ToolchainCorruptError('patch'), 'corrupt'],
    [new Error('unexpected end of tar'), 'corrupt'],
    [new RangeError('WebAssembly.Memory(): could not allocate memory'), 'startup'],
    [new Error('Out of memory'), 'startup'],
  ] as const)('%s -> %s', (err, kind) => {
    expect(classifyLoadFailure(err)).toBe(kind);
  });

  it('only a download failure tells the learner to check the connection', () => {
    expect(describeLoadFailure('download', 'x')).toMatch(/internet connection/);
    expect(describeLoadFailure('corrupt', 'x')).not.toMatch(/internet connection/);
    expect(describeLoadFailure('startup', 'x')).not.toMatch(/internet connection/);
  });
});

describe('loadToolchain', () => {
  const bundle = (run: (fetchAll: () => Promise<void>) => Promise<void>, tf: ReturnType<typeof setup>['tf']) => async () => ({
    runClang: (async () => { await run(async () => { await (await tf.fetch(url('big.wasm'))).text(); }); return {}; }) as never,
  });

  it('returns only after the cache is complete: a put still running holds it back', async () => {
    const { cache, tf } = setup({ 'big.wasm': ok('data') });
    const gate = deferred();
    cache.gate = gate.p;
    let finished = false;
    const loading = loadToolchain({ tf, importBundle: bundle(f => f(), tf), onProgress: () => {} }).then(() => { finished = true; });
    await new Promise(r => setTimeout(r, 20));
    expect(finished, 'the compiler is compiled, but the cache is not complete yet').toBe(false);
    gate.release();
    await loading;
    expect(cache.entries.has(url('big.wasm'))).toBe(true);
  });

  it('a corrupt cached file is evicted, so the next attempt fetches a good one', async () => {
    const { cache, tf, requested } = setup({ 'big.wasm': ok('good') });
    cache.entries.set(url('big.wasm'), new TextEncoder().encode('garbage'));
    let bytes = '';
    const importBundle = async () => ({
      runClang: (async () => {
        bytes = await (await tf.fetch(url('big.wasm'))).text();
        if (bytes !== 'good') throw Object.assign(new Error('WebAssembly.compile(): expected magic word'), { name: 'CompileError' });
        return {};
      }) as never,
    });
    const first = await loadToolchain({ tf, importBundle, onProgress: () => {} }).catch(e => e);
    expect(first).toBeInstanceOf(ToolchainLoadError);
    expect((first as ToolchainLoadError).kind).toBe('corrupt');
    expect(cache.entries.size, 'the garbage is gone').toBe(0);
    await loadToolchain({ tf, importBundle, onProgress: () => {} });
    expect(bytes).toBe('good');
    expect(requested).toEqual([url('big.wasm')]);
  });

  it('an out-of-memory failure keeps the cache', async () => {
    const { cache, tf } = setup({});
    cache.entries.set(url('big.wasm'), new TextEncoder().encode('fine'));
    const importBundle = async () => ({ runClang: (async () => { await tf.fetch(url('big.wasm')); throw new RangeError('could not allocate memory'); }) as never });
    const err = await loadToolchain({ tf, importBundle, onProgress: () => {} }).catch(e => e);
    expect((err as ToolchainLoadError).kind).toBe('startup');
    expect(cache.entries.size).toBe(1);
  });
});

describe('toolchainView', () => {
  const loading: ToolchainState = { status: 'loading', done: 1, total: 2 };
  const failed: ToolchainState = { status: 'error', kind: 'download', message: 'x' };
  it('a terminal that only explains failures ignores a download it did not start', () => {
    expect(toolchainView(loading, { errorOnly: true, retried: false })).toBeNull();
    expect(toolchainView(loading, { errorOnly: false, retried: false })).toBe('progress');
  });
  it('shows the error everywhere, and progress and the ready note after Retry was pressed here', () => {
    expect(toolchainView(failed, { errorOnly: true, retried: false })).toBe('error');
    expect(toolchainView(loading, { errorOnly: true, retried: true })).toBe('progress');
    expect(toolchainView({ status: 'ready', ms: 1, fromCache: false }, { errorOnly: true, retried: true })).toBe('ready-note');
    expect(toolchainView({ status: 'ready', ms: 1, fromCache: false }, { errorOnly: false, retried: false })).toBeNull();
  });
});

describe('patchBundleSource', () => {
  const real = () => {
    const root = join(process.cwd(), 'public/toolchain');
    const dir = readdirSync(root).find(d => d.startsWith('clang-'));
    if (!dir) throw new Error('run `npm run toolchain:prepare` first: public/toolchain is missing');
    return readFileSync(join(root, dir, 'bundle.js'), 'utf8');
  };

  it('the shipped bundle only uses import.meta.url as new URL(name, import.meta.url), and the patch replaces every use', () => {
    const source = real();
    expect(source.split('import.meta.url').length - 1).toBeGreaterThan(0);
    const patched = patchBundleSource(source, 'https://example.test/b.js');
    expect(patched).not.toContain('import.meta');
    expect(patched).toContain('new URL("./llvm.core.wasm", "https://example.test/b.js")');
  });

  it.each([
    ['no use', 'export {}'],
    ['a bare use', 'const here = import.meta.url;'],
    ['another import.meta property', 'new URL("a", import.meta.url); import.meta.dirname;'],
    ['a call that is not new URL', 'new URL("a", import.meta.url); String(base, import.meta.url)'],
    ['import.meta.url inside another expression', 'new URL("a", import.meta.url); fileURLToPath(import.meta.url)'],
  ])('refuses a bundle with %s', (_, source) => {
    expect(() => patchBundleSource(source, 'u')).toThrow(/does not know/);
  });
});
