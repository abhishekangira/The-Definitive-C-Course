#!/usr/bin/env bash
# Shared by CI and the portable development image. Run as root on Ubuntu 24.04.
# --ffmpeg-only installs just FFmpeg (CI's e2e jobs need no compilers).
set -euo pipefail
. /etc/os-release
if [[ "$ID" != ubuntu || "$VERSION_ID" != 24.04 || "$EUID" != 0 ]]; then
  echo 'Native installation requires root on Ubuntu 24.04; use npm run setup for automatic Docker fallback.' >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
if [[ "${1:-}" == --ffmpeg-only ]]; then
  apt-get install -y --no-install-recommends ffmpeg
  exit 0
fi
apt-get install -y --no-install-recommends ca-certificates curl gnupg
install -d -m 0755 /etc/apt/keyrings
key=$(mktemp)
trap 'rm -f "$key"' EXIT
curl -fsSL https://apt.llvm.org/llvm-snapshot.gpg.key -o "$key"
fingerprint=$(gpg --batch --show-keys --with-colons "$key" | awk -F: '$1 == "fpr" {print $10; exit}')
if [[ "$fingerprint" != 6084F3CF814B57C1CF12EFD515CF4D18AF4F7421 ]]; then
  echo "apt.llvm.org's signing key changed; check it and update the fingerprint in install-native.sh (got ${fingerprint:-none})" >&2
  exit 1
fi
install -m 0644 "$key" /etc/apt/keyrings/apt.llvm.org.asc
echo 'deb [signed-by=/etc/apt/keyrings/apt.llvm.org.asc] https://apt.llvm.org/noble/ llvm-toolchain-noble-22 main' > /etc/apt/sources.list.d/llvm-22.list
apt-get update
apt-get install -y --no-install-recommends gcc gcc-13 make clang-22 lld-22 libclang-rt-22-dev lldb-22 llvm-22 gdb valgrind ffmpeg python3 git xz-utils
