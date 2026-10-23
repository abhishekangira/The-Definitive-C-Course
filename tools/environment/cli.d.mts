export function selectBackend(capabilities: {
  hostReady: boolean;
  /** Why the host probe (doctor.sh --versions) failed; named in the error when nothing is usable. */
  hostError?: string;
  dockerReady: boolean;
  dockerCli?: 'missing' | 'found';
  dockerError?: string;
  canInstall: boolean;
  forceContainer: boolean;
  forceHost: boolean;
}): 'host' | 'container';
export function dockerConfigProxies(configDir?: string): { httpProxy?: string; httpsProxy?: string; noProxy?: string };
export function proxyArgs(
  environment: Record<string, string | undefined>,
  flag: '-e' | '--build-arg',
  configured?: { httpProxy?: string; httpsProxy?: string; noProxy?: string },
): string[];
export function readStatus(file?: string): Record<string, string>;
export const lockHash: string;
export const image: string;
