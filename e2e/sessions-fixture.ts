// A throwaway Vite dev server for the m97 fixture course in e2e/fixtures/sessions (like unreleased-modules.spec.ts):
// no shipped module has a native session yet, so <Transcript> and <CompilerError session> are tested on the sessions
// tools/verify wrote for the m97 fixture module (tools/verify/fixtures/generated/sessions, linked in as
// src/generated/sessions). It serves the real public/ folder, so the browser compiler works after `npm run build`.
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { ROOT } from './lib';

export const FIXTURE = path.join(ROOT, 'e2e', 'fixtures', 'sessions');

export async function startSessionsFixture(): Promise<{ url: string; close: () => Promise<void> }> {
  const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'tdcc-e2e-vite-'));
  const server = await createServer({
    configFile: path.join(ROOT, 'vite.config.ts'),
    root: FIXTURE,
    publicDir: path.join(ROOT, 'public'),
    cacheDir,
    logLevel: 'error',
    resolve: { alias: [{ find: /^(\.\.\/)+content\/course\.yaml$/, replacement: path.join(FIXTURE, 'content', 'course.yaml') }] },
    server: { port: 0, host: '127.0.0.1', hmr: false, fs: { strict: false } },
  });
  await server.listen();
  return {
    url: `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}/`,
    close: async () => { await server.close(); rmSync(cacheDir, { recursive: true, force: true }); },
  };
}
