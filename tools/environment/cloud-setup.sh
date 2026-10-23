#!/usr/bin/env bash
# The setup script of a cloud agent environment (Codex, Claude Code...): `bash tools/environment/cloud-setup.sh`.
# The only script that builds or installs anything; agents only run `npm run doctor`, and the maintenance script
# (cloud-maintain.sh) only checks. Writes .cache/environment/status.txt, one line per capability, then
# state: ready (native, npm, chromium), limited (npm only, or no chromium) or blocked (no npm dependencies; exit 1).
set -uo pipefail
cd "$(dirname "$0")/../.."
# The npm cache cli.mjs uses: the provider's $HOME may be missing or read-only at setup time (Codex: ENOENT on ~/.npm).
export npm_config_cache=$PWD/.cache/npm
cache=${TDCC_ENVIRONMENT_CACHE:-.cache/environment}
mkdir -p "$cache"
status=$cache/status.txt
echo '== What this machine can do'
grep PRETTY_NAME /etc/os-release || true
echo "uid=$(id -u) arch=$(uname -m) node=$(node --version 2>&1)"
echo "docker: $(docker info --format '{{.ServerVersion}}' 2>&1 | head -1)"
echo "vm.mmap_rnd_bits: $(cat /proc/sys/vm/mmap_rnd_bits 2>&1)"
df -h . | tail -1
echo '== npm run setup'
if npm run setup; then
  cat "$status"
  grep -q '^npm: ready' "$status" # setup exits 0 only with npm ready; check rather than assume
  exit
fi
if grep -q '^native: ready' "$status" 2>/dev/null; then cat "$status"; exit 1; fi # toolchain fine, npm ci failed
# No CI toolchain: still give the agent the npm dependencies and say exactly what is missing.
reason=$(sed -n 's/^reason: //p' "$status" 2>/dev/null)
echo '== npm dependencies without the native toolchain'
if npm ci && npm run toolchain:prepare; then npm="ready $(sha256sum package-lock.json | cut -c1-16)"; else npm=failed; fi
if browser=$(node tools/environment/cli.mjs chromium 2>/dev/null); then chromium="ready $browser"; else chromium=unavailable; fi
if [[ $npm == ready* ]]; then state=limited; else state=blocked; fi
printf 'backend: none\nnative: unavailable (%s); leave native checks to CI\nnpm: %s\nchromium: %s\nstate: %s\n' \
  "${reason:-npm run setup failed}" "$npm" "$chromium" "$state" > "$status"
cat "$status"
[[ $state == limited ]]
