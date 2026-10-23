# The CI toolchain for agents whose host is not Ubuntu 24.04 (README.md). Built by `npm run setup`, which tags it
# with a hash of this file, install-native.sh and the Playwright version, so a change to any of them rebuilds it.
# The base is docker.io/library/ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac,
# pulled by default through Google's mirror (no Docker Hub anonymous pull limits). TDCC_BASE_IMAGE names an approved
# mirror instead; cli.mjs requires the same digest. There is no automatic fallback to another registry.
ARG BASE=mirror.gcr.io/library/ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
FROM ${BASE}
ARG PLAYWRIGHT_VERSION
# A proxy's CA bundle, if the host has one, is a BuildKit secret: used by the RUN steps, never stored in a layer.
# mode=0444: apt downloads as the unprivileged _apt user, which can't read the default 0400 secret (public certificates only).
# First prove a build step reaches HTTPS, so a proxy or CA problem is reported as one instead of as an install failure.
RUN --mount=type=secret,id=ca,required=false,mode=0444 set -eu; \
    if [ -s /run/secrets/ca ]; then export CURL_CA_BUNDLE=/run/secrets/ca; fi; \
    apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ca-certificates curl >/dev/null; \
    curl -fsS -o /dev/null https://apt.llvm.org/llvm-snapshot.gpg.key \
      || { echo 'tdcc: HTTPS from a docker build step failed (proxy or CA certificates); the curl error is above.' >&2; exit 1; }; \
    rm -rf /var/lib/apt/lists/*
COPY install-native.sh /tmp/install-native.sh
RUN --mount=type=secret,id=ca,required=false,mode=0444 set -eu; \
    if [ -s /run/secrets/ca ]; then \
      export CURL_CA_BUNDLE=/run/secrets/ca SSL_CERT_FILE=/run/secrets/ca; \
      echo 'Acquire::https::CaInfo "/run/secrets/ca";' > /etc/apt/apt.conf.d/80-tdcc-ca; \
    fi; \
    bash /tmp/install-native.sh; rm -f /tmp/install-native.sh /etc/apt/apt.conf.d/80-tdcc-ca
RUN --mount=type=secret,id=ca,required=false,mode=0444 set -eu; cd /tmp; \
    if [ -s /run/secrets/ca ]; then export CURL_CA_BUNDLE=/run/secrets/ca; fi; \
    arch=$(dpkg --print-architecture); \
    case "$arch" in amd64) node_arch=x64;; arm64) node_arch=arm64;; *) exit 1;; esac; \
    file="node-v22.22.2-linux-$node_arch.tar.xz"; \
    curl -fsSLO https://nodejs.org/dist/v22.22.2/SHASUMS256.txt; \
    curl -fsSLO "https://nodejs.org/dist/v22.22.2/$file"; \
    awk -v file="$file" '$2 == file {print}' SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "$file" -C /usr/local --strip-components=1; \
    rm "$file" SHASUMS256.txt
# Chromium for `npm run e2e`, from the lockfile's Playwright version; readable by the unprivileged run user.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN --mount=type=secret,id=ca,required=false,mode=0444 set -eu; \
    if [ -s /run/secrets/ca ]; then \
      export NODE_EXTRA_CA_CERTS=/run/secrets/ca; \
      echo 'Acquire::https::CaInfo "/run/secrets/ca";' > /etc/apt/apt.conf.d/80-tdcc-ca; \
    fi; \
    test -n "$PLAYWRIGHT_VERSION"; \
    npx -y -p "@playwright/test@$PLAYWRIGHT_VERSION" playwright install --with-deps chromium; \
    chmod -R a+rX /ms-playwright; \
    rm -rf /root/.npm /var/lib/apt/lists/* /etc/apt/apt.conf.d/80-tdcc-ca
ENV LC_ALL=C
