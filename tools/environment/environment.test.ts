import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { dockerConfigProxies, image, lockHash, proxyArgs, selectBackend } from './cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const absent = { hostReady: false, dockerReady: false, canInstall: false, forceContainer: false, forceHost: false };
const scratch = mkdtempSync(path.join(tmpdir(), 'tdcc-env-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function tool(dir: string, name: string, body: string) {
  writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(path.join(dir, name), 0o755);
}
/** Stand-ins for the CI toolchain that behave like the real tools on doctor.sh's probes; FAKE_* variables break one. */
const fakes = mkdtempSync(path.join(scratch, 'bin-'));
const compiler = (version: string) => `if [ "$1" = --version ]; then echo "${version}"; exit 0; fi
out=; src=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift;; *.c) src=$1;; esac; shift; done
body='exit 0'
case "$src" in *overflow.c) [ -n "$FAKE_ASAN_MISS" ] || body='echo "ERROR: AddressSanitizer: heap-buffer-overflow" >&2; exit 1';; esac
printf '#!/bin/sh\\n%s\\n' "$body" > "$out"; chmod +x "$out"`;
tool(fakes, 'gcc', compiler('${FAKE_GCC_VERSION:-gcc (Ubuntu 13.3.0-6ubuntu2) 13.3.0}'));
tool(fakes, 'gcc-14', compiler('gcc-14 (Ubuntu 14.2.0-4ubuntu2~24.04) 14.2.0'));
tool(fakes, 'clang-22', compiler('Ubuntu clang version 22.1.8'));
tool(fakes, 'lldb-22', '[ "$1" = --version ] && { echo "lldb version 22.1.8"; exit 0; }; echo "stop reason = breakpoint 1.1"');
tool(fakes, 'gdb', `[ "$1" = --version ] && { echo "GNU gdb (Ubuntu 15.0.50.20240403-0ubuntu1) 15.0.50.20240403-git"; exit 0; }
case "$*" in *python*) [ -n "$FAKE_GDB_NO_PYTHON" ] && { echo "Python scripting is not supported in this copy of GDB."; exit 1; }; echo tdcc-42;;
*) [ -n "$FAKE_GDB_ASLR" ] && echo "warning: Error disabling address space randomization: Operation not permitted"; echo "Breakpoint 1, main () at ok.c:1";; esac`);
tool(fakes, 'valgrind', `[ "$1" = --version ] && { echo valgrind-3.22.0; exit 0; }
for last; do :; done
case "$last" in */leak) [ -n "$FAKE_VALGRIND_MISS" ] && exit 0; echo "definitely lost: 64 bytes in 1 blocks"; exit 99;; esac
echo "ERROR SUMMARY: 0 errors from 0 contexts"`);
tool(fakes, 'node', 'echo "${FAKE_NODE:-v22.22.2}"');
for (const name of ['make', 'llvm-symbolizer-22', 'ffmpeg', 'python3']) tool(fakes, name, 'exit 0');
const doctor = (env: NodeJS.ProcessEnv = {}) => spawnSync('/bin/bash', [path.join(here, 'doctor.sh')], {
  encoding: 'utf8', env: { ...process.env, GCC: '', CLANG22: '', LLDB22: '', ...env, PATH: `${fakes}:${process.env.PATH}` },
});

describe('portable environment setup', () => {
  it('uses Docker when system installation is unavailable, and reuses a ready host', () => {
    expect(selectBackend({ ...absent, dockerReady: true })).toBe('container');
    expect(selectBackend({ ...absent, dockerReady: true, hostReady: true })).toBe('host');
    expect(selectBackend({ ...absent, canInstall: true })).toBe('host');
  });
  it('reports the missing capabilities, telling a missing docker from an unreachable daemon', () => {
    expect(() => selectBackend(absent)).toThrow(/No docker executable on PATH/);
    expect(() => selectBackend({ ...absent, dockerCli: 'found', dockerError: 'permission denied while trying to connect to the Docker daemon socket' }))
      .toThrow(/Docker CLI found, but no daemon is reachable from this account \(docker info: permission denied while trying/);
    expect(() => selectBackend({ ...absent, hostReady: true, forceContainer: true })).toThrow(/no usable Docker/);
  });
  it('names why the host toolchain was ruled out', () => {
    expect(() => selectBackend({ ...absent, hostError: 'Node v20.19.0 is older than 22, which CI runs.' }))
      .toThrow(/No compatible host toolchain and no usable Docker\. Host toolchain: Node v20\.19\.0 is older than 22, which CI runs\. No docker/);
    expect(() => selectBackend({ ...absent, hostError: 'x', forceContainer: true })).not.toThrow(/Host toolchain/);
  });
  it('doctor without a saved backend, a matching host or Docker reports the host check that failed', () => {
    const bin = mkdtempSync(path.join(scratch, 'nodocker-'));
    tool(bin, 'docker', '[ "$1" = --version ] && { echo "Docker version 29.0.0"; exit 0; }; echo "Cannot connect to the Docker daemon" >&2; exit 1');
    const r = spawnSync(process.execPath, [path.join(here, 'cli.mjs'), 'doctor'], {
      encoding: 'utf8', env: { ...process.env, GCC: '', CLANG22: '', LLDB22: '', FAKE_GCC_VERSION: 'gcc (Debian 14.2.0-19) 14.2.0',
        PATH: `${bin}:${fakes}:${process.env.PATH}`, TDCC_ENVIRONMENT_CACHE: path.join(bin, 'environment') },
    });
    expect(r.stderr).toContain('Host toolchain: Missing or incompatible gcc (expected ^gcc.* 13');
    expect(r.stderr).toContain('Docker CLI found, but no daemon is reachable');
    expect(r.status).toBe(1);
  });
  it('honours an explicit host/container choice', () => {
    expect(selectBackend({ ...absent, hostReady: true, dockerReady: true, forceContainer: true })).toBe('container');
    expect(selectBackend({ ...absent, dockerReady: true, forceHost: true })).toBe('host');
  });
  it('forwards only the proxy variables the Docker config does not already give, and never switches networks', () => {
    expect(proxyArgs({}, '-e')).toEqual([]);
    expect(proxyArgs({ HTTPS_PROXY: 'http://proxy.internal:3128', no_proxy: 'localhost' }, '--build-arg'))
      .toEqual(['--build-arg', 'HTTPS_PROXY=http://proxy.internal:3128', '--build-arg', 'no_proxy=localhost']);
    expect(proxyArgs({ http_proxy: 'http://127.0.0.1:8080' }, '-e')).toEqual(['-e', 'http_proxy=http://127.0.0.1:8080']);
    expect(proxyArgs({ HTTPS_PROXY: 'http://a:1', https_proxy: 'http://a:1', NO_PROXY: 'x' }, '-e', { httpsProxy: 'http://a:1' }))
      .toEqual(['-e', 'NO_PROXY=x']);
    const config = mkdtempSync(path.join(scratch, 'docker-config-'));
    writeFileSync(path.join(config, 'config.json'), JSON.stringify({ proxies: { default: { httpsProxy: 'http://p:3128' } } }));
    expect(dockerConfigProxies(config)).toEqual({ httpsProxy: 'http://p:3128' });
    expect(dockerConfigProxies(path.join(config, 'absent'))).toEqual({});
  });
  it('setup with Docker installed but not running says so and writes a blocked status file', () => {
    const bin = mkdtempSync(path.join(scratch, 'docker-'));
    tool(bin, 'docker', '[ "$1" = --version ] && { echo "Docker version 29.0.0"; exit 0; }; echo "permission denied while trying to connect to the Docker daemon socket" >&2; exit 0'); // docker info --format exits 0 without a daemon
    const cache = path.join(bin, 'environment');
    const r = spawnSync(process.execPath, [path.join(here, 'cli.mjs'), 'setup', '--container'], {
      encoding: 'utf8', env: { ...process.env, PATH: bin, TDCC_ENVIRONMENT_CACHE: cache },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Docker CLI found, but no daemon is reachable from this account (docker info: permission denied while trying');
    expect(readFileSync(path.join(cache, 'status.txt'), 'utf8')).toMatch(/^native: unavailable\nreason: .*no daemon.*\nstate: blocked\n$/m);
  });
  const cli = (cache: string, bin: string, ...argv: string[]) => spawnSync(process.execPath, [path.join(here, 'cli.mjs'), ...argv], {
    encoding: 'utf8', env: { ...process.env, PATH: bin, TDCC_ENVIRONMENT_CACHE: cache },
  });
  const prepared = (lines: string) => {
    const dir = mkdtempSync(path.join(scratch, 'prepared-'));
    writeFileSync(path.join(dir, 'status.txt'), lines);
    tool(dir, 'docker', 'echo "$*" >> "${0%/*}/docker.log"; exit 1'); // every image is missing
    return dir;
  };
  it('doctor and env use the backend setup saved instead of probing again', () => {
    const dir = prepared('backend: container\nimage: tdcc-dev:0000000000000000\nnative: ready\nstate: ready\n');
    const r = cli(dir, dir, 'doctor');
    expect(r.stderr).toContain('setup prepared tdcc-dev:0000000000000000, but the Dockerfile, installer or Playwright version now give');
    expect(existsSync(path.join(dir, 'docker.log'))).toBe(false); // no docker --version or docker info
    const missing = prepared(`backend: container\nimage: ${image}\nnative: ready\nstate: ready\n`);
    const m = cli(missing, missing, 'run', 'true');
    expect(m.stderr).toContain(`The prepared image ${image} is missing. Run npm run setup`);
    expect(readFileSync(path.join(missing, 'docker.log'), 'utf8')).toBe(`image inspect ${image}\n`);
  });
  it('cloud-maintain.sh only checks: a missing image fails it and nothing is built', () => {
    const dir = prepared(`backend: container\nimage: ${image}\nnative: ready\nnpm: ready ${lockHash}\nstate: ready\n`);
    const r = spawnSync('/bin/bash', [path.join(here, 'cloud-maintain.sh')], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TDCC_ENVIRONMENT_CACHE: dir },
    });
    expect(r.stderr).toContain(`The prepared image ${image} is missing and there is no ${dir}/image.tar.`);
    expect(r.status).toBe(1);
    expect(readFileSync(path.join(dir, 'docker.log'), 'utf8')).not.toMatch(/build|pull/);
    const none = spawnSync('/bin/bash', [path.join(here, 'cloud-maintain.sh')], {
      encoding: 'utf8', env: { ...process.env, TDCC_ENVIRONMENT_CACHE: path.join(dir, 'absent') },
    });
    expect(none.stderr).toContain('this environment was never set up');
    expect(none.status).toBe(1);
  });
  it('cloud-setup.sh and cloud-maintain.sh give npm the repo cache, never $HOME/.npm', () => {
    const dir = mkdtempSync(path.join(scratch, 'npm-cache-'));
    // `npm run setup` fails (no toolchain), every other npm call logs the cache it was given.
    tool(dir, 'npm', 'if [ "$1 $2" = "run setup" ]; then exit 1; fi; echo "$1 $npm_config_cache" >> "${0%/*}/npm.log"');
    const run = (script: string) => spawnSync('/bin/bash', [path.join(here, script)], {
      encoding: 'utf8', env: { ...process.env, npm_config_cache: '', HOME: path.join(dir, 'no-home'), PATH: `${dir}:${process.env.PATH}`, TDCC_ENVIRONMENT_CACHE: dir },
    });
    const expected = `ci ${path.resolve(here, '../..')}/.cache/npm`;
    expect(run('cloud-setup.sh').status).toBe(0); // state: limited
    expect(readFileSync(path.join(dir, 'npm.log'), 'utf8').split('\n')).toContain(expected);
    rmSync(path.join(dir, 'npm.log'));
    writeFileSync(path.join(dir, 'status.txt'), 'backend: none\nnpm: ready 0000000000000000\nstate: limited\n'); // lockfile "changed"
    expect(run('cloud-maintain.sh').status).toBe(0);
    expect(readFileSync(path.join(dir, 'npm.log'), 'utf8').split('\n')).toContain(expected);
  });
  it('doctor fails for a missing compiler and does not print Ready', () => {
    const r = spawnSync('/bin/bash', [path.join(here, 'doctor.sh'), '--versions'], {
      encoding: 'utf8', env: { ...process.env, GCC: '', PATH: '/nonexistent-tdcc-tools' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Missing or incompatible gcc');
    expect(r.stdout).not.toContain('Ready');
  });
  it('doctor prints Ready when every probe behaves like the CI toolchain', () => {
    const r = doctor();
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('gcc: gcc (Ubuntu 13.3.0-6ubuntu2) 13.3.0');
    expect(r.stdout).toMatch(/^Ready: /m);
    expect(r.status).toBe(0);
  });
  it.each([
    ['a sanitizer that misses a heap overflow', { FAKE_ASAN_MISS: '1' }, /AddressSanitizer \(gcc\) catching a heap overflow failed/],
    ['valgrind that misses a leak', { FAKE_VALGRIND_MISS: '1' }, /valgrind finding a leak failed/],
    ['gdb that cannot disable address randomisation', { FAKE_GDB_ASLR: '1' }, /GDB cannot disable address space randomization/],
    ['gdb without Python', { FAKE_GDB_NO_PYTHON: '1' }, /GDB Python failed/],
    ['a plain gcc that is not gcc 13 (the verifier and tools/trace call gcc)', { FAKE_GCC_VERSION: 'gcc (Debian 14.2.0-19) 14.2.0' }, /Missing or incompatible gcc \(/],
    ['a GCC override that is not gcc 13', { GCC: 'gcc-14' }, /Missing or incompatible gcc-14/],
    ['a Node older than 22', { FAKE_NODE: 'v20.19.0' }, /Node v20\.19\.0 is older than 22, which CI runs\. The container backend ships 22\.22\.2/],
  ])('doctor fails for %s', (_name, env, message) => {
    const r = doctor(env);
    expect(r.stderr).toMatch(message);
    expect(r.stdout).not.toContain('Ready');
    expect(r.status).toBe(1);
  });
  it('doctor accepts any Node 22, even below package.json engines, without a warning', () => {
    const r = doctor({ FAKE_NODE: 'v22.22.0' });
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatch(/^Ready: /m);
    expect(r.status).toBe(0);
  });
  it('doctor accepts a newer Node that satisfies engines, with a warning that CI runs 22', () => {
    const r = doctor({ FAKE_NODE: 'v24.11.0' });
    expect(r.stderr).toContain('warning: node v24.11.0; CI runs Node 22.');
    expect(r.stdout).toMatch(/^Ready: /m);
    expect(r.status).toBe(0);
  });
  it('gives a mirror of the same base digest the same image tag', () => {
    const digest = readFileSync(path.join(here, 'Dockerfile'), 'utf8').match(/^ARG BASE=\S+(@sha256:[0-9a-f]{64})$/m)![1];
    const tag = (base: string) => spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { image } from ${JSON.stringify(path.join(here, 'cli.mjs'))}; console.log(image);`], {
      encoding: 'utf8', env: { ...process.env, TDCC_BASE_IMAGE: base },
    }).stdout.trim();
    expect(tag(`docker.io/library/ubuntu:24.04${digest}`)).toBe(image);
    expect(image).toMatch(/^tdcc-dev:[0-9a-f]{16}$/);
  });
  it('lets apt (the unprivileged _apt user) read the CA secret in every build step', () => {
    const mounts = readFileSync(path.join(here, 'Dockerfile'), 'utf8').match(/--mount=type=secret\S*/g) ?? [];
    expect(mounts.length).toBeGreaterThan(0);
    for (const mount of mounts) expect(mount, 'add mode=0444: the default 0400 secret is unreadable to apt').toContain('mode=0444');
  });
  it('uses the same native installer in CI and Docker', () => {
    const workflow = readFileSync(path.resolve(here, '../../.github/workflows/ci.yml'), 'utf8');
    const dockerfile = readFileSync(path.join(here, 'Dockerfile'), 'utf8');
    expect(workflow).toContain('sudo bash tools/environment/install-native.sh');
    expect(workflow).not.toContain('apt-get install');
    expect(dockerfile).toContain('bash /tmp/install-native.sh');
  });
});
