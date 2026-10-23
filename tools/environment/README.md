# Development environment for cloud agents

One way to get CI's native toolchain (Ubuntu 24.04, gcc 13, clang/lldb 22, gdb 15,
valgrind 3.22, Node 22) on any Linux machine or WSL: use the host when it already
matches, otherwise a Docker image built from the same installer CI runs. The entry
point, `cli.mjs`, needs only some Node 22 and no npm dependencies. `doctor` checks only the
backend's Node major version: 22 passes, older fails, newer passes with a warning. CI runs the
latest 22 and the image ships 22.22.2.

```sh
npm run setup                 # once per machine, or after a change here or to the Playwright version
npm run doctor                # every task: proves the toolchain works, installs nothing
npm run env -- npm test       # any native command
npm run env -- npm run verify -- --check
npm run build && CI=1 npm run env -- npm run e2e   # the image has its own Chromium
```

**Agents check, they don't set up** (root `AGENTS.md`, step 3).

## Cloud environments (Codex, Claude Code, other bots)

- **Setup script:** `bash tools/environment/cloud-setup.sh`. The only script that builds or
  installs. It logs what the machine can do (OS, uid, Node, Docker, `vm.mmap_rnd_bits`, free
  disk), runs `npm run setup`, and if the native toolchain can't be had still runs `npm ci`
  and `toolchain:prepare`. It exits non-zero when the npm dependencies failed. Both scripts, like
  `cli.mjs`, keep the npm cache in `.cache/npm`, so a missing or read-only `$HOME` (Codex) is fine.
- **Maintenance script:** `bash tools/environment/cloud-maintain.sh`. Check-only, never builds:
  the saved backend and image must still exist (it restores `.cache/environment/image.tar` if
  `image.tar.sha256` verifies it; make one with `docker save` and `sha256sum`), it reruns
  `npm ci` only when `package-lock.json` changed, and it runs the doctor. If it fails, rerun the
  setup script, which for Codex means republishing the environment.

Codex now publishes environment snapshots: the filesystem the setup script prepared is
captured, and refreshing a task restores it without rerunning installs (not the older
12-hour container cache). Whether a Docker daemon and its images survive into a task
depends on the provider; `cloud-maintain.sh` and `npm run doctor` show it.

## What setup does

It picks a backend: the host if `doctor.sh --versions` passes; else Docker, building or
reusing `tdcc-dev:<hash>` (the hash covers `Dockerfile`, `install-native.sh`, the base's digest and
the lockfile's `@playwright/test` version); else, with root or passwordless sudo on Ubuntu
24.04, `install-native.sh` on the host. `--container` or `--host` forces one. No `docker` on
PATH and a daemon it can't reach are reported apart, with `docker info`'s own error (a
permission error is not a stopped daemon). Then it runs the doctor, `npm ci` (cache in
`.cache/npm`), `toolchain:prepare` and a Chromium check, and writes
`.cache/environment/status.txt`: backend, image, tool versions, and one line per capability
(`native`, `npm` with the lockfile hash, `chromium`), then `state: ready` (all three),
`limited` (npm dependencies, but no native toolchain or no Chromium) or `blocked` (with the
reason). `doctor` and `env` use the saved backend without probing again, and stop if the
saved image is missing or no longer matches the Dockerfile.

`doctor` checks the commands the tools call (`GCC`, default `gcc`, and plain `gcc` too;
`CLANG22`; `LLDB22`) and Node (major 22; older fails, newer warns), then with a timeout on each probe compiles
with gcc and clang under ASan+UBSan, needs ASan to catch a heap overflow and valgrind to
find a leak, stops GDB (failing on `Error disabling address space randomization`) and LLDB
at a breakpoint, and runs GDB's Python. It prints `Ready` only when all of that passed.

`env` runs a command with `LC_ALL=C` and `umask 022`; in the container as your uid/gid,
with only the checkout (and a worktree's main `.git`) mounted at its real path, `HOME=/tmp`,
`--init`, `--shm-size=1g` and `--security-opt seccomp=unconfined` so gdb and lldb can turn
off address randomisation, as on the CI runner, which has no seccomp filter. No
`--privileged`, no added capabilities. `CI`, `E2E_PORT`, `GCC`, `CLANG22`, `LLDB22` and
`CHROMIUM_PATH` are passed through when set.

## CI and container parity

`.github/workflows/toolchain-image.yml` builds the image with `cli.mjs setup --container`
and runs `npm run env -- npm test` inside it on changes to `tools/environment/**`,
`package-lock.json` or the workflow itself (PRs and pushes to `main`), or on manual dispatch.
It logs build/setup time, image size and the doctor's status, and never publishes the image.

`.github/workflows/ci.yml` and the Dockerfile both call `install-native.sh` (CI's e2e jobs
with `--ffmpeg-only`, and with `TDCC_APT_ARCHIVES=<dir>` so the downloaded `.deb` files land in a
folder CI caches); change the package list there only. It fails with `apt.llvm.org's signing key changed` if the key's
fingerprint differs. The base is `docker.io/library/ubuntu:24.04` at a recorded digest,
pulled by default through `mirror.gcr.io` (no Docker Hub anonymous pull limits);
`TDCC_BASE_IMAGE` names another approved mirror, which must carry the same digest. There is
no automatic fallback to another registry. If `mirror.gcr.io` refuses the pull (`Forbidden`, seen
in Codex), set `TDCC_BASE_IMAGE=docker.io/library/ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac`
in the environment's variables. The image tag depends on the digest only, so later tasks
reuse the image with or without the variable. Node is 22.22.2. Apt patch releases drift, as on
CI; CI stays the authority for generated output. macOS (Apple clang, `leaks`) runs only in
`targets.yml`; no image covers it.

## Network, proxies and certificates

A fresh build needs the base registry, the Ubuntu mirrors, apt.llvm.org, nodejs.org,
registry.npmjs.org and Playwright's CDN; a reused image needs only npm. Docker itself gives
containers and builds the proxies in `~/.docker/config.json` (`proxies`); setup forwards
`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` (either case) only when that config doesn't, and
never changes the container network. Setup reports which hop failed: the daemon's pull of
the base (the daemon's own proxy settings apply there), HTTPS from a build step, or HTTPS
from a running container, each with the real error, and stops. TLS verification is never
turned off. When the host has extra CA certificates (`/usr/local/share/ca-certificates`,
`SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`), setup writes them to
`.cache/environment/ca-bundle.pem` and gives the build a temporary BuildKit secret mount and
the container a read-only mount; no certificate is stored in the image.

The image is about 2.8 GB.
