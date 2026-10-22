import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { selectBackend } from './cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const absent = { hostReady: false, dockerReady: false, canInstall: false, forceContainer: false, forceHost: false };

describe('portable environment setup', () => {
  it('uses Docker when system installation is unavailable, and reuses a ready host', () => {
    expect(selectBackend({ ...absent, dockerReady: true })).toBe('container');
    expect(selectBackend({ ...absent, dockerReady: true, hostReady: true })).toBe('host');
    expect(selectBackend({ ...absent, canInstall: true })).toBe('host');
  });
  it('reports the missing capabilities instead of pretending setup succeeded', () => {
    expect(() => selectBackend(absent)).toThrow(/usable Docker daemon/);
    expect(() => selectBackend({ ...absent, hostReady: true, forceContainer: true })).toThrow(/Enable Docker/);
  });
  it('honours an explicit host/container choice', () => {
    expect(selectBackend({ ...absent, hostReady: true, dockerReady: true, forceContainer: true })).toBe('container');
    expect(selectBackend({ ...absent, dockerReady: true, forceHost: true })).toBe('host');
  });
  it('doctor fails for a missing compiler and does not print Ready', () => {
    const r = spawnSync('/bin/bash', [path.join(here, 'doctor.sh'), '--versions'], {
      encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent-tdcc-tools' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Missing or incompatible gcc-13');
    expect(r.stdout).not.toContain('Ready');
  });
  it('uses the same native installer in CI and Docker', () => {
    const workflow = readFileSync(path.resolve(here, '../../.github/workflows/ci.yml'), 'utf8');
    const dockerfile = readFileSync(path.join(here, 'Dockerfile'), 'utf8');
    expect(workflow).toContain('sudo bash tools/environment/install-native.sh');
    expect(workflow).not.toContain('apt-get install');
    expect(dockerfile).toContain('bash /tmp/install-native.sh');
  });
});
