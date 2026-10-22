# Development environment for cloud agents

This is the shared setup path for Codex, Claude Code and other agents running in
Linux workspaces or WSL. It needs Node >=22.22.2 to start, and either a compatible
native toolchain, a usable Docker daemon, or root/passwordless sudo on Ubuntu
24.04. No npm dependencies are needed to run the setup entry point.

```sh
npm run setup                 # once per fresh workspace, or after a dependency update
npm run doctor                # reuse the prepared environment in later tasks
npm run env -- npm test -- --maxWorkers=2
npm run env -- npm run verify -- --generated-root .cache/generated
```

`setup` first detects the installed tools. It reuses a compatible host; otherwise
it checks Docker, and builds/reuses a source-hashed Ubuntu 24.04 image. Without
Docker it can install natively on Ubuntu 24.04 with root/passwordless sudo. It
then runs functional tool checks, `npm ci` against the unchanged lockfile, and
prepares the browser compiler assets. It uses `.cache/npm` so a read-only home
directory does not break installation. A second setup reuses the image but
deliberately refreshes npm dependencies; use `doctor` for ordinary task startup.

`doctor` compiles and runs real C with GCC and Clang plus ASan/UBSan, and reaches
source breakpoints in GDB and LLDB. It exits nonzero on missing or incompatible
tools. It does not install packages or build images. `env` runs the supplied
command with the selected native toolchain, `LC_ALL=C` and `umask 022`. Container
commands use the calling UID/GID and mount only the current checkout at its real
path; no `/workspace` layout or agent-specific files are required.

Use `--container` or `--host` to choose explicitly, for example
`npm run setup -- --container` and `npm run doctor -- --container`.
`npm run env -- --container gcc-13 --version` chooses the container for a command.
The scripts currently target Linux/WSL; macOS learners can still use the native
local-project workflow described in PLAN.md, but that is a different toolchain.

## CI and container parity

`.github/workflows/ci.yml` and the Dockerfile both call `install-native.sh`.
Change the package list there, not in two independent recipes. It selects GCC
13, LLVM/Clang/LLDB 22, GDB 15 and Valgrind 3.22 on Ubuntu 24.04, plus compiler-rt,
LLVM symbolizer, Make, Python and FFmpeg. Apt patch releases can drift, just as on
CI. The image pins its Ubuntu base digest and Node 22.22.2; the host Node may be
newer. CI remains the authority for generated output.

`docker-seccomp.json` is the upstream Moby default profile, vendored from
https://github.com/moby/profiles/blob/main/seccomp/default.json (Apache-2.0;
see `MOBY-LICENSE`). The launcher adds one argument-specific permission for
`personality(ADDR_NO_RANDOMIZE)` so debuggers can launch their child processes.
It does not use privileged containers or disable the seccomp filter. Docker
still needs to be usable from the agent account; a binary alone is insufficient.

## Networking, browsers and persistence

Fresh installs need the Ubuntu apt mirrors, apt.llvm.org, nodejs.org,
registry.npmjs.org and the Docker registry/CDN. Reused images require no compiler
downloads. The build context contains only the recipe and public CA bundles
copied from system certificate locations, SSL_CERT_FILE or NODE_EXTRA_CA_CERTS.
Custom proxy trust is retained; TLS, apt signatures, the LLVM signing-key
fingerprint and Node archive checksums are verified. Certificates and generated
security settings stay in ignored `.cache/environment`, never in Git. Docker
builds and CA handling require no secrets or raw token extraction.

This prepares the native verifier and npm dependencies, not a browser. Run the
app/build on the host with the README commands. For Playwright, reuse an installed
Chromium via CHROMIUM_PATH or the path detected by playwright.config.ts; otherwise
use `npx playwright install --with-deps chromium` where system installation is
allowed. Do not install a browser merely because one particular path is absent.

Persist the Docker image/cache through the cloud provider when supported. A new
machine with no image will rebuild it; the repository does not contain a large
image archive. If neither native installation nor Docker is available, setup
reports those precise prerequisites. Do not invent compiler aliases, edit
expected output, disable checks, or conclude that an unset token or missing sudo
alone proves there is no supported setup route. Each task is already isolated;
use its existing checkout rather than creating a worktree for environment setup.
