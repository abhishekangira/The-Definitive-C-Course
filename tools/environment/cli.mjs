// Dependency-free: setup must run before npm ci on a fresh checkout. Any Node 22 can run it; the toolchain's Node
// (package.json engines) is checked by doctor.sh in the selected backend.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cache = process.env.TDCC_ENVIRONMENT_CACHE ?? path.join(root, '.cache/environment');
const statusFile = path.join(cache, 'status.txt');
const lockfile = readFileSync(path.join(root, 'package-lock.json'));
const playwright = JSON.parse(lockfile.toString()).packages['node_modules/@playwright/test'].version;
const defaultBase = readFileSync(path.join(here, 'Dockerfile'), 'utf8').match(/^ARG BASE=(\S+)$/m)[1];
const baseDigest = defaultBase.slice(defaultBase.indexOf('@'));
const base = process.env.TDCC_BASE_IMAGE || defaultBase;
const digest = createHash('sha256');
for (const file of ['Dockerfile', 'install-native.sh']) digest.update(readFileSync(path.join(here, file)));
digest.update(`playwright ${playwright}\nbase ${base}`);
export const image = `tdcc-dev:${digest.digest('hex').slice(0, 16)}`;
export const lockHash = createHash('sha256').update(lockfile).digest('hex').slice(0, 16);
const [action, ...argv] = process.argv.slice(2);
const forceContainer = argv[0] === '--container';
const forceHost = argv[0] === '--host';
const args = forceContainer || forceHost ? argv.slice(1) : argv;
const env = { ...process.env, LC_ALL: 'C', npm_config_cache: path.join(root, '.cache/npm'), DOCKER_BUILDKIT: '1',
  BUILDX_CONFIG: process.env.BUILDX_CONFIG ?? path.join(cache, 'buildx') };
let selected = 'none'; // for the status file when setup fails
// Passed into the container when set: CI=1 gives e2e CI's workers and retries; the overrides doctor.sh honours.
const PASS_VARS = ['CI', 'E2E_PORT', 'GCC', 'CLANG22', 'LLDB22', 'CHROMIUM_PATH'];
const HTTPS_PROBE = 'https://registry.npmjs.org/';
// The browser playwright.config.ts would launch, so setup can record whether e2e can run.
const CHROMIUM_CHECK = `const fs = require('fs'); const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const p = process.env.CHROMIUM_PATH || (fs.existsSync(local) ? local : require('@playwright/test').chromium.executablePath());
fs.accessSync(p, fs.constants.X_OK); console.log(p);`;

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, env, stdio: 'inherit', ...options });
}
function works(command, args) { return run(command, args, { stdio: 'ignore', timeout: 20_000 }).status === 0; }
/** '' when doctor.sh --versions passes on the host, otherwise the last line it printed (why the host was ruled out). */
function hostProblem() {
  const r = run('/bin/bash', [path.join(here, 'doctor.sh'), '--versions'], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 20_000 });
  if (r.status === 0) return '';
  return (r.stderr ?? '').trim().split('\n').filter(Boolean).pop() ?? r.error?.message ?? `doctor.sh exited with ${r.status ?? r.signal}`;
}
function must(command, args, options) {
  const result = run(command, args, options);
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw Object.assign(new Error(`${[command, ...args].join(' ')} exited with ${result.status ?? result.signal}`), { status: result.status ?? 1 });
  }
  return result;
}
const firstLines = text => text.trim().split('\n').filter(Boolean).slice(-3).join(' / ');

/** dockerCli: 'missing', or the error `docker info` printed ('' when the daemon answered). hostError: why the host probe failed. */
export function selectBackend({ hostReady, hostError = '', dockerReady, dockerCli = 'missing', dockerError = '', canInstall, forceContainer, forceHost }) {
  if (forceHost) return 'host';
  if (!forceContainer && hostReady) return 'host';
  if (dockerReady) return 'container';
  if (!forceContainer && canInstall) return 'host';
  const docker = dockerCli === 'missing' ? 'No docker executable on PATH'
    : `Docker CLI found, but no daemon is reachable from this account (docker info: ${dockerError || 'failed'})`;
  const host = !forceContainer && hostError ? ` Host toolchain: ${hostError}` : '';
  throw new Error(`No compatible host toolchain and no usable Docker.${host} ${docker}. Otherwise provide root or passwordless sudo on Ubuntu 24.04 (npm run setup -- --host).`);
}

/** The proxies ~/.docker/config.json gives every container and build; Docker applies them itself. */
export function dockerConfigProxies(configDir = process.env.DOCKER_CONFIG ?? path.join(homedir(), '.docker')) {
  try { return JSON.parse(readFileSync(path.join(configDir, 'config.json'), 'utf8')).proxies?.default ?? {}; }
  catch { return {}; }
}
/** -e / --build-arg pairs for the host's proxy variables the Docker config does not already provide. */
export function proxyArgs(environment, flag, configured = {}) {
  const key = { http_proxy: 'httpProxy', https_proxy: 'httpsProxy', no_proxy: 'noProxy' };
  return ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']
    .filter(name => environment[name] && !configured[key[name.toLowerCase()]])
    .flatMap(name => [flag, `${name}=${environment[name]}`]);
}

/** The host's CA bundle, when the admin or a proxy added certificates: a BuildKit secret and a read-only mount, never baked in. */
function caBundle() {
  const extras = [];
  const local = '/usr/local/share/ca-certificates';
  if (existsSync(local)) extras.push(...readdirSync(local).filter(f => f.endsWith('.crt')).map(f => path.join(local, f)));
  for (const name of ['SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS']) if (process.env[name]) extras.push(process.env[name]);
  if (!extras.filter(existsSync).length) return undefined;
  const files = [...new Set(['/etc/ssl/certs/ca-certificates.crt', ...extras])].filter(existsSync);
  const bundle = path.join(cache, 'ca-bundle.pem');
  mkdirSync(cache, { recursive: true });
  writeFileSync(bundle, files.map(f => {
    const value = readFileSync(f, 'utf8');
    if (!value.includes('BEGIN CERTIFICATE') || value.includes('PRIVATE KEY')) throw new Error(`Expected public CA certificates in ${f}`);
    return value.trim() + '\n';
  }).join('\n'));
  return bundle;
}

function dockerArgs(targetImage = image) {
  const ca = caBundle();
  // A worktree's .git file points into the main checkout's .git, which must be mounted too for git to work.
  const git = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  const gitDir = git.status === 0 ? git.stdout.trim() : '';
  // seccomp=unconfined lets gdb and lldb turn off address randomisation, as on the CI runner, which has no seccomp
  // filter. No --privileged and no added capabilities; the commands run as the calling user.
  return ['run', '--rm', '--init', '-i', '--user', `${process.getuid()}:${process.getgid()}`,
    '--security-opt', 'seccomp=unconfined', '--shm-size=1g',
    '--mount', `type=bind,source=${root},target=${root}`, '--workdir', root,
    ...(gitDir && !gitDir.startsWith(root + path.sep) ? ['--mount', `type=bind,source=${gitDir},target=${gitDir}`] : []),
    ...(ca ? ['--mount', `type=bind,source=${ca},target=/run/tdcc-ca.pem,readonly`,
      '-e', 'NODE_EXTRA_CA_CERTS=/run/tdcc-ca.pem', '-e', 'CURL_CA_BUNDLE=/run/tdcc-ca.pem'] : []),
    '-e', 'LC_ALL=C', '-e', 'HOME=/tmp', '-e', `npm_config_cache=${env.npm_config_cache}`,
    ...PASS_VARS.filter(name => process.env[name]).flatMap(name => ['-e', name]),
    ...proxyArgs(process.env, '-e', dockerConfigProxies()), targetImage];
}
function buildImage() {
  if (!base.endsWith(baseDigest)) throw new Error(`TDCC_BASE_IMAGE must be a mirror of the recorded base, ending in ${baseDigest}; got ${base}.`);
  // Pull separately so a registry or daemon-proxy problem is reported as such, not as a build failure.
  if (!works('docker', ['image', 'inspect', base])) {
    const pull = run('docker', ['pull', base], { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' });
    if (pull.status !== 0) throw new Error(`The Docker daemon could not pull ${base}: ${firstLines(pull.stderr ?? String(pull.error))}. The daemon's own proxy settings apply here, not this shell's.`);
  }
  const context = path.join(cache, 'build');
  mkdirSync(context, { recursive: true });
  for (const file of ['Dockerfile', 'install-native.sh']) copyFileSync(path.join(here, file), path.join(context, file));
  const ca = caBundle();
  const log = path.join(cache, 'build.log');
  const build = ['docker', 'build', '--progress=plain', '-t', image, '--build-arg', `BASE=${base}`,
    '--build-arg', `PLAYWRIGHT_VERSION=${playwright}`, ...(ca ? ['--secret', `id=ca,src=${ca}`] : []),
    ...proxyArgs(process.env, '--build-arg', dockerConfigProxies()), context];
  const result = run('/bin/bash', ['-o', 'pipefail', '-c', '"$@" 2>&1 | tee "$0"', log, ...build]);
  if (result.status !== 0) {
    const output = readFileSync(log, 'utf8');
    const https = output.includes('tdcc: HTTPS from a docker build step failed');
    const error = output.split('\n').filter(l => /curl: \(|ERROR|E: |error:/i.test(l)).slice(-3).join(' / ');
    throw new Error(`${https ? 'HTTPS from a docker build step failed' : 'docker build failed'}: ${error || 'see the output above'} (log: ${path.relative(root, log)}).`);
  }
}
function containerHttps() {
  const result = run('docker', [...dockerArgs(), 'curl', '-fsS', '-o', '/dev/null', HTTPS_PROBE], { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`HTTPS from a running container failed (${HTTPS_PROBE}): ${firstLines(result.stderr ?? String(result.error))}.`);
}
function wrap(backend, command) {
  const shell = ['/bin/bash', '-c', 'umask 022; exec "$@"', 'tdcc', ...command];
  return backend === 'container' ? ['docker', [...dockerArgs(), ...shell]] : [shell[0], shell.slice(1)];
}
function inside(backend, command, options) { return must(...wrap(backend, command), options); }
export function readStatus(file = statusFile) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter(l => l.includes(': '))
    .map(l => [l.slice(0, l.indexOf(': ')), l.slice(l.indexOf(': ') + 2)]));
}
function writeStatus(lines) {
  mkdirSync(cache, { recursive: true });
  writeFileSync(statusFile, lines.join('\n') + '\n');
}
function probeDocker() {
  const version = run('docker', ['--version'], { stdio: 'ignore', timeout: 20_000 });
  if (version.error?.code === 'ENOENT') return { dockerCli: 'missing', dockerReady: false };
  const info = run('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 20_000 });
  // With --format, docker info exits 0 even when it cannot reach a daemon, so require a server version.
  const dockerReady = info.status === 0 && Boolean(info.stdout?.trim());
  return { dockerCli: 'found', dockerReady, dockerError: firstLines(info.stderr || String(info.error ?? 'docker info printed no server version')) };
}

function main() {
  if (process.platform !== 'linux') throw new Error('This CI environment setup targets Linux cloud agents and WSL. Use a Linux workspace for the complete native verification workflow.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error(`cli.mjs needs Node 22 or later to start; found ${process.version}.`);
  if (action === 'chromium') { must(process.execPath, ['-e', CHROMIUM_CHECK]); return; } // for cloud-setup.sh
  if (!['setup', 'doctor', 'run'].includes(action)) throw new Error('Usage: npm run setup [-- --container|--host], npm run doctor, npm run env -- <command>');
  if (action === 'run' && !args.length) throw new Error('Pass a command: npm run env -- npm test');
  const saved = readStatus();
  let backend;
  if (action !== 'setup' && !forceContainer && !forceHost && saved.native === 'ready' && ['host', 'container'].includes(saved.backend)) {
    backend = saved.backend; // prepared by setup: no re-probing
    if (backend === 'container' && saved.image !== image) {
      throw new Error(`setup prepared ${saved.image}, but the Dockerfile, installer or Playwright version now give ${image}. Run npm run setup.`);
    }
  } else {
    const hostError = forceContainer ? 'not probed' : hostProblem();
    const hostReady = !hostError;
    const docker = !forceHost && (!hostReady || forceContainer) ? probeDocker() : { dockerCli: 'missing', dockerReady: false };
    const osRelease = existsSync('/etc/os-release') ? readFileSync('/etc/os-release', 'utf8') : '';
    const ubuntu = /^ID=ubuntu$/m.test(osRelease) && /^VERSION_ID="24\.04"$/m.test(osRelease);
    const canInstall = action === 'setup' && ubuntu && (process.getuid() === 0 || works('sudo', ['-n', 'true']));
    backend = selectBackend({ hostReady, hostError, ...docker, canInstall, forceContainer, forceHost });
  }
  selected = backend;
  console.log(`Toolchain: ${backend}${backend === 'container' ? ` (${image})` : ''}`);
  if (backend === 'container') {
    if (!works('docker', ['image', 'inspect', image])) {
      if (action !== 'setup') throw new Error(`The prepared image ${image} is missing. Run npm run setup (or npm run setup -- --container).`);
      buildImage();
    } else if (action === 'setup') console.log(`Reusing the image ${image}.`);
    if (action === 'setup') containerHttps();
  } else if (action === 'setup' && !works('/bin/bash', [path.join(here, 'doctor.sh'), '--versions'])) {
    const isRoot = process.getuid() === 0;
    must(isRoot ? '/bin/bash' : 'sudo', [...(isRoot ? [] : ['-n', '/bin/bash']), path.join(here, 'install-native.sh')]);
  }
  if (action === 'setup') {
    const doctor = inside(backend, ['/bin/bash', path.join(here, 'doctor.sh')], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
    process.stdout.write(doctor.stdout);
    const header = [`backend: ${backend}`, ...(backend === 'container' ? [`image: ${image}`, `base: ${base}`] : []),
      ...doctor.stdout.split('\n').filter(line => /^[\w.+-]+: /.test(line)), 'native: ready'];
    try { inside(backend, ['npm', 'ci']); inside(backend, ['npm', 'run', 'toolchain:prepare']); } catch (error) {
      writeStatus([...header, `npm: failed (${error.message})`, 'state: blocked']);
      throw Object.assign(error, { statusWritten: true });
    }
    const chromium = run(...wrap(backend, ['node', '-e', CHROMIUM_CHECK]), { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    const browser = chromium.status === 0 ? `ready ${chromium.stdout.trim()}` : 'unavailable';
    writeStatus([...header, `npm: ready ${lockHash}`, `chromium: ${browser}`, `state: ${chromium.status === 0 ? 'ready' : 'limited'}`]);
    console.log(`Setup complete (${path.relative(root, statusFile)}, chromium ${browser}). Reuse with npm run doctor and npm run env -- <command>.`);
  } else if (action === 'doctor') inside(backend, ['/bin/bash', path.join(here, 'doctor.sh')]);
  else inside(backend, args);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    if (action !== 'run' || !error.status) console.error(error.message); // env: the command's own exit status is the answer
    process.exitCode = error.status ?? 1;
    if (action === 'setup' && !error.statusWritten) {
      writeStatus([`backend: ${selected}`, ...(selected === 'container' ? [`image: ${image}`] : []), 'native: unavailable',
        `reason: ${error.message.replace(/\n/g, ' ')}`, 'state: blocked']);
    }
  }
}
