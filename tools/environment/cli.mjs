// Dependency-free: setup must run before npm ci on a fresh checkout.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cache = path.join(root, '.cache/environment');
const recipe = ['Dockerfile', 'install-native.sh', 'docker-seccomp.json'];
const digest = createHash('sha256');
for (const file of recipe) digest.update(readFileSync(path.join(here, file)));
const image = `tdcc-dev:${digest.digest('hex').slice(0, 16)}`;
const [action, ...argv] = process.argv.slice(2);
const forceContainer = argv[0] === '--container';
const forceHost = argv[0] === '--host';
const args = forceContainer || forceHost ? argv.slice(1) : argv;
const env = { ...process.env, LC_ALL: 'C', npm_config_cache: path.join(root, '.cache/npm'),
  BUILDX_CONFIG: process.env.BUILDX_CONFIG ?? path.join(cache, 'buildx') };

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, env, stdio: 'inherit', ...options });
}
function works(command, args) { return run(command, args, { stdio: 'ignore', timeout: 10_000 }).status === 0; }
function must(command, args, options) {
  const result = run(command, args, options);
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function selectBackend({ hostReady, dockerReady, canInstall, forceContainer, forceHost }) {
  if (forceHost) return 'host';
  if (!forceContainer && hostReady) return 'host';
  if (dockerReady) return 'container';
  if (!forceContainer && canInstall) return 'host';
  throw new Error('No compatible host toolchain or usable Docker daemon. Enable Docker, or provide root/passwordless sudo on Ubuntu 24.04. Missing sudo alone does not establish that setup is impossible.');
}

function dockerArgs() {
  return ['run', '--rm', '--init', '-i', '--user', `${process.getuid()}:${process.getgid()}`,
    '--security-opt', `seccomp=${path.join(cache, 'seccomp.json')}`,
    '--mount', `type=bind,source=${root},target=${root}`, '--workdir', root,
    '-e', 'LC_ALL=C', '-e', 'HOME=/tmp', '-e', `npm_config_cache=${env.npm_config_cache}`,
    '-e', 'NODE_EXTRA_CA_CERTS=/etc/ssl/certs/tdcc-ca-bundle.pem', image];
}
function prepareProfile() {
  mkdirSync(cache, { recursive: true });
  const profile = JSON.parse(readFileSync(path.join(here, 'docker-seccomp.json'), 'utf8'));
  profile.syscalls.push({ names: ['personality'], action: 'SCMP_ACT_ALLOW', args: [{ index: 0, value: 262144, op: 'SCMP_CMP_EQ' }] });
  writeFileSync(path.join(cache, 'seccomp.json'), JSON.stringify(profile));
}
function buildImage() {
  const context = path.join(cache, 'build');
  mkdirSync(context, { recursive: true });
  for (const file of ['Dockerfile', 'install-native.sh']) copyFileSync(path.join(here, file), path.join(context, file));
  const sources = ['/etc/ssl/certs/ca-certificates.crt'];
  const extra = '/usr/local/share/ca-certificates';
  if (existsSync(extra)) sources.push(...readdirSync(extra).filter(f => f.endsWith('.crt')).map(f => path.join(extra, f)));
  for (const name of ['SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS']) if (env[name]) sources.push(env[name]);
  const certificates = [...new Set(sources)].filter(existsSync).map(f => {
    const value = readFileSync(f, 'utf8');
    if (!value.includes('BEGIN CERTIFICATE') || value.includes('PRIVATE KEY')) throw new Error(`Expected public CA certificates in ${f}`);
    return value.trim() + '\n';
  });
  if (!certificates.length) throw new Error('No system CA bundle found. Supply SSL_CERT_FILE pointing to a trusted public CA bundle.');
  writeFileSync(path.join(context, 'ca-bundle.pem'), certificates.join('\n'));
  must('docker', ['build', '-t', image, context]);
}
function inside(backend, command) {
  if (backend === 'container') must('docker', [...dockerArgs(), '/bin/bash', '-c', 'umask 022; exec "$@"', 'tdcc', ...command]);
  else must('/bin/bash', ['-c', 'umask 022; exec "$@"', 'tdcc', ...command]);
}

function main() {
  if (process.platform !== 'linux') throw new Error('This CI environment setup targets Linux cloud agents and WSL. Use a Linux workspace for the complete native verification workflow.');
  if (!['setup', 'doctor', 'run'].includes(action)) throw new Error('Usage: npm run setup [-- --container|--host], npm run doctor, npm run env -- <command>');
  if (action === 'run' && !args.length) throw new Error('Pass a command: npm run env -- npm test');
  const hostReady = works('/bin/bash', [path.join(here, 'doctor.sh'), '--versions']);
  const dockerReady = !forceHost && (!hostReady || forceContainer) && works('docker', ['info']);
  const ubuntu = existsSync('/etc/os-release') && /\bID=ubuntu\b/.test(readFileSync('/etc/os-release', 'utf8')) && /VERSION_ID="24\.04"/.test(readFileSync('/etc/os-release', 'utf8'));
  const isRoot = process.getuid?.() === 0;
  const canInstall = ubuntu && (isRoot || works('sudo', ['-n', 'true']));
  const backend = selectBackend({ hostReady, dockerReady, canInstall: action === 'setup' && canInstall, forceContainer, forceHost });
  console.log(`Toolchain: ${backend}${backend === 'container' ? ` (${image})` : ''}`);
  if (backend === 'container') {
    prepareProfile();
    if (!works('docker', ['image', 'inspect', image])) {
      if (action !== 'setup') throw new Error('Prepared image missing. Run npm run setup (or npm run setup -- --container).');
      buildImage();
    }
  } else if (action === 'setup' && !hostReady) {
    if (!canInstall) throw new Error('Host installation requires root/passwordless sudo on Ubuntu 24.04. Try npm run setup -- --container.');
    must(isRoot ? '/bin/bash' : 'sudo', [...(isRoot ? [] : ['-n', '/bin/bash']), path.join(here, 'install-native.sh')]);
  }
  if (action === 'setup') {
    inside(backend, ['/bin/bash', path.join(here, 'doctor.sh')]);
    inside(backend, ['npm', 'ci']);
    inside(backend, ['npm', 'run', 'toolchain:prepare']);
    console.log('Setup complete. Reuse with npm run doctor and npm run env -- <command>.');
  } else if (action === 'doctor') inside(backend, ['/bin/bash', path.join(here, 'doctor.sh')]);
  else inside(backend, args);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
