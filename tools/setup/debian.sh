#!/usr/bin/env bash
# Sets up a Debian 13 machine to match CI's `check` job (.github/workflows/ci.yml): the native toolchain, a gcc wrapper
# with Ubuntu 24.04's default hardening, LC_ALL=C, npm ci, the browser toolchain and Playwright's Chromium.
# Run it from anywhere in the checkout with `npm run localsetup:debian` (add `-- --bashrc` to also source the
# environment from ~/.bashrc). Safe to re-run: it installs only what is missing and rewrites its own files.
set -euo pipefail

# The apt packages of ci.yml's "Install the native toolchain" step. tools/setup/debian.test.ts fails when they drift.
APT_PACKAGES=(gcc-13 clang-22 lld-22 libclang-rt-22-dev lldb-22 llvm-22 gdb valgrind ffmpeg python3)
# On the ubuntu-24.04 runner image but not on a minimal Debian; check.mjs projects need it.
EXTRA_PACKAGES=(make)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLCHAIN="$ROOT/.cache/toolchain" # .cache/ is gitignored
BIN="$TOOLCHAIN/bin"
ENV_FILE="$TOOLCHAIN/env.sh"
BASHRC=0
for arg in "$@"; do
  case "$arg" in
    --bashrc) BASHRC=1 ;;
    -h|--help) sed -n '2,5p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "localsetup:debian: unknown option $arg (only --bashrc)" >&2; exit 2 ;;
  esac
done
cd "$ROOT"

# 1. Debian 13 only: there clang-22 and gcc-13 are in the standard repos. Ubuntu needs ci.yml's apt.llvm.org source.
# shellcheck source=/dev/null
. /etc/os-release 2>/dev/null || { echo "localsetup:debian: no /etc/os-release, so this is not Debian." >&2; exit 1; }
if [ "${ID:-}" != debian ]; then
  echo "localsetup:debian: this is ${PRETTY_NAME:-${ID:-unknown}}, not Debian. Follow the \"Install the native toolchain\" step in .github/workflows/ci.yml instead." >&2
  exit 1
fi
[ "${VERSION_ID:-}" = 13 ] || echo "WARNING: written for Debian 13; this is ${PRETTY_NAME:-Debian}, so some packages may not exist." >&2

# 2. Node: `npm run` needs it already, so check it rather than install it. CI uses Node 22.
# shellcheck disable=SC2016 # JavaScript, not shell
node -e '
  const want = require("./package.json").engines.node.replace(/^>=/, "").split(".").map(Number);
  const have = process.versions.node.split(".").map(Number);
  const cmp = have.map((n, i) => n - want[i]).find(d => d !== 0) ?? 0;
  if (cmp < 0) { console.error(`localsetup:debian: Node ${process.versions.node} is older than package.json engines (>=${want.join(".")}). Install Node 22 (for example nvm install 22) and re-run.`); process.exit(1); }
  if (have[0] !== 22) console.error(`WARNING: Node ${process.versions.node}; CI uses Node 22.`);
'

# 3. Native packages. Root, or passwordless sudo, is needed only when one is missing.
SUDO=()
if [ "$(id -u)" -eq 0 ]; then CAN_ROOT=1; elif command -v sudo >/dev/null && sudo -n true 2>/dev/null; then CAN_ROOT=1; SUDO=(sudo); else CAN_ROOT=0; fi
missing=()
for p in "${APT_PACKAGES[@]}" "${EXTRA_PACKAGES[@]}"; do
  dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || missing+=("$p")
done
if [ ${#missing[@]} -eq 0 ]; then
  echo "apt: all ${#APT_PACKAGES[@]}+${#EXTRA_PACKAGES[@]} packages already installed"
elif [ "$CAN_ROOT" -eq 0 ]; then
  echo "WARNING: not root and no passwordless sudo, so these packages were NOT installed: ${missing[*]}" >&2
  echo "WARNING: install them as root (apt-get install -y --no-install-recommends ${missing[*]}) and re-run." >&2
else
  echo "apt: installing ${missing[*]}"
  "${SUDO[@]}" apt-get update
  "${SUDO[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
fi

# 4. A `gcc` that is gcc-13 plus the hardening Ubuntu 24.04's gcc (CI's compiler) turns on by default. tools/verify,
#    tools/trace and tools/exercises call plain `gcc`, so this has to come first on PATH.
mkdir -p "$BIN"
cat > "$BIN/gcc" <<'WRAP'
#!/bin/sh
# gcc-13 with Ubuntu 24.04's default hardening: stack protector, stack-clash protection, CET, format-security as an
# error, PIE and full RELRO; _FORTIFY_SOURCE=3 only when optimizing, as Ubuntu does. Written by tools/setup/debian.sh.
fortify=
for a in "$@"; do case "$a" in -O|-O[1-3sz]|-Ofast|-Og) fortify="-D_FORTIFY_SOURCE=3";; -O0) fortify=;; esac; done
exec gcc-13 -fstack-protector-strong -fstack-clash-protection -fcf-protection -Wformat -Wformat-security -Werror=format-security \
  -fPIE -pie -Wl,-z,relro,-z,now $fortify "$@"
WRAP
chmod +x "$BIN/gcc"
cat > "$ENV_FILE" <<ENV
# Written by tools/setup/debian.sh. Source it in each shell: . "$ENV_FILE"
case ":\$PATH:" in *":$BIN:"*) ;; *) export PATH="$BIN:\$PATH" ;; esac
export LC_ALL=C
ENV
# shellcheck source=/dev/null
. "$ENV_FILE"

# 5. The repo's dependencies, the browser toolchain and Playwright's Chromium (--with-deps installs its system libraries).
npm ci
npm run toolchain:prepare
# A preinstalled browser folder (the cloud container's /opt/pw-browsers, AGENTS.md) is left alone.
if [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && compgen -G "$PLAYWRIGHT_BROWSERS_PATH/chromium-*" >/dev/null; then
  echo "playwright: Chromium is already in PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH; not installing"
elif [ "$CAN_ROOT" -eq 0 ]; then npx playwright install chromium
else npx playwright install --with-deps chromium; fi

# 6. Optional: source the environment from ~/.bashrc, in one marked block that a re-run replaces.
BEGIN="# >>> The-Definitive-C-Course localsetup:debian >>>"
END="# <<< The-Definitive-C-Course localsetup:debian <<<"
if [ "$BASHRC" -eq 1 ]; then
  touch "$HOME/.bashrc"
  tmp="$(mktemp)"
  awk -v b="$BEGIN" -v e="$END" '$0 == b { skip = 1; next } $0 == e { skip = 0; next } !skip' "$HOME/.bashrc" > "$tmp"
  printf '%s\n[ -f "%s" ] && . "%s"\n%s\n' "$BEGIN" "$ENV_FILE" "$ENV_FILE" "$END" >> "$tmp"
  cat "$tmp" > "$HOME/.bashrc" && rm -f "$tmp"
  echo "$HOME/.bashrc: sources $ENV_FILE"
fi

# 7. One line per tool, so a missing one is obvious.
echo
echo "Versions (PATH starts with $BIN, LC_ALL=$LC_ALL):"
n_missing=0
for c in "gcc --version" "gcc-13 --version" "clang-22 --version" "lldb-22 --version" "llvm-symbolizer-22 --version" \
         "gdb --version" "valgrind --version" "make --version" "ffmpeg -version" "python3 --version" "node --version"; do
  if command -v "${c%% *}" >/dev/null; then
    echo "$c: $($c 2>&1 | grep -m 1 '[0-9]')" # the first line with a version number
  else
    echo "$c: MISSING"; n_missing=$((n_missing + 1))
  fi
done
echo "gcc is $(command -v gcc)"
if [ "$n_missing" -gt 0 ]; then
  echo "localsetup:debian: $n_missing tool(s) MISSING; see the warnings above." >&2
  exit 1
fi
if [ "$BASHRC" -eq 1 ]; then
  echo "Done. Open a new shell (or run: . \"$ENV_FILE\") to get the gcc wrapper and LC_ALL=C."
else
  echo "Done. In each shell, run: . \"$ENV_FILE\"  (or re-run with -- --bashrc to add it to ~/.bashrc)"
fi
