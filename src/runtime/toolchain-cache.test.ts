import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyLoadFailure, createToolchainFetch, describeLoadFailure, patchBundleSource, ToolchainDownloadError } from './toolchain-cache';

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
    const discarding = tf.discardAttempt();
    gate.release(); // the put finishes only now; discardAttempt must still remove it
    await discarding;
    expect([...cache.entries.keys()]).toEqual([url('good.wasm')]);
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
    [Object.assign(new Error('bad wasm'), { name: 'CompileError' }), 'download'],
    [new ToolchainDownloadError('HTTP 404'), 'download'],
    [new RangeError('WebAssembly.Memory(): could not allocate memory'), 'startup'],
    [new Error('something else'), 'startup'],
  ] as const)('%s -> %s', (err, kind) => {
    expect(classifyLoadFailure(err)).toBe(kind);
  });

  it('only a download failure tells the learner to check the connection', () => {
    expect(describeLoadFailure('download', 'x')).toMatch(/internet connection/);
    expect(describeLoadFailure('startup', 'x')).not.toMatch(/internet connection/);
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
  ])('refuses a bundle with %s', (_, source) => {
    expect(() => patchBundleSource(source, 'u')).toThrow(/does not know/);
  });
});
