// Docker access failures must not be treated as evidence that an image is absent.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Returns false only when Docker explicitly reports a missing image; preserves other failures. */
export function imageExists(image, options = {}) {
  const result = spawnSync('docker', ['image', 'inspect', image], {
    ...options, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 20_000,
  });
  if (result.status === 0) return true;
  const detail = result.stderr?.trim() || result.error?.message || `docker exited with ${result.status ?? result.signal}`;
  if (!result.error && result.status !== null && /(?:No such image|No such object): /i.test(detail)) return false;
  throw new Error(`Cannot inspect Docker image ${image}: ${detail}\nImage presence is unknown. Check Docker daemon/socket access and the task's execution permissions.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node docker-image.mjs <image>');
    process.exitCode = imageExists(process.argv[2]) ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
