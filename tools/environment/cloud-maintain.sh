#!/usr/bin/env bash
# The maintenance script of a cloud agent environment: `bash tools/environment/cloud-maintain.sh`. Check-only: it
# never builds the image or installs system packages. It confirms the backend setup saved still exists (restoring a
# verified .cache/environment/image.tar if the image is gone), reruns npm ci only if package-lock.json changed, and
# runs the doctor. A failure means: rerun the setup script (republish the environment).
set -uo pipefail
cd "$(dirname "$0")/../.."
# The npm cache cli.mjs uses: the provider's $HOME may be missing or read-only at setup time (Codex: ENOENT on ~/.npm).
export npm_config_cache=$PWD/.cache/npm
cache=${TDCC_ENVIRONMENT_CACHE:-.cache/environment}
status=$cache/status.txt
fail() {
  local advice=${2:-}
  [[ -n $advice ]] || advice="Rerun the environment's setup script (cloud-setup.sh)."
  echo "cloud-maintain: $1 $advice" >&2
  exit 1
}
[[ -f $status ]] || fail "No $status: this environment was never set up."
field() { sed -n "s/^$1: //p" "$status" | head -1; }
backend=$(field backend) image=$(field image) npm=$(field npm)
image_status=0
if [[ $backend == container ]]; then
  node tools/environment/docker-image.mjs "$image" || image_status=$?
  (( image_status == 0 || image_status == 2 )) || fail 'Docker image inspection failed; image presence is unknown.' 'Check task execution permissions and Docker access before retrying this check.'
fi
if (( image_status == 2 )); then
  archive=$cache/image.tar
  [[ -f $archive && -f $archive.sha256 ]] || fail "The prepared image $image is missing and there is no $archive."
  sha256sum -c --status "$archive.sha256" || fail "$archive does not match $archive.sha256."
  docker load -i "$archive" && node tools/environment/docker-image.mjs "$image" || fail "$archive did not restore $image."
fi
lock=$(sha256sum package-lock.json | cut -c1-16)
if [[ $npm != "ready $lock" ]]; then
  echo "package-lock.json changed since setup (${npm:-none} -> $lock): npm ci"
  if [[ $backend == none ]]; then npm ci && npm run toolchain:prepare || fail 'npm ci failed.'
  else npm run env -- npm ci && npm run env -- npm run toolchain:prepare || fail 'npm ci failed.'; fi
  sed -i "s/^npm: .*/npm: ready $lock/" "$status"
fi
if [[ $backend != none ]]; then npm run doctor || fail 'The doctor failed.'; fi
cat "$status"
