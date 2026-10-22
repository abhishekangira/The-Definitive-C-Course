export function selectBackend(capabilities: {
  hostReady: boolean;
  dockerReady: boolean;
  canInstall: boolean;
  forceContainer: boolean;
  forceHost: boolean;
}): 'host' | 'container';
