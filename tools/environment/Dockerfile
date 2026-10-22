FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
COPY ca-bundle.pem /etc/ssl/certs/tdcc-ca-bundle.pem
ENV CURL_CA_BUNDLE=/etc/ssl/certs/tdcc-ca-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/tdcc-ca-bundle.pem
RUN chmod 0644 /etc/ssl/certs/tdcc-ca-bundle.pem && \
    echo 'Acquire::https::CaInfo "/etc/ssl/certs/tdcc-ca-bundle.pem";' > /etc/apt/apt.conf.d/80-tdcc-ca
COPY install-native.sh /tmp/install-native.sh
RUN bash /tmp/install-native.sh && rm /tmp/install-native.sh
RUN set -eu; cd /tmp; \
    arch=$(dpkg --print-architecture); \
    case "$arch" in amd64) node_arch=x64;; arm64) node_arch=arm64;; *) exit 1;; esac; \
    file="node-v22.22.2-linux-$node_arch.tar.xz"; \
    curl -fsSLO https://nodejs.org/dist/v22.22.2/SHASUMS256.txt; \
    curl -fsSLO "https://nodejs.org/dist/v22.22.2/$file"; \
    awk -v file="$file" '$2 == file {print}' SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "$file" -C /usr/local --strip-components=1; \
    rm "$file" SHASUMS256.txt; rm -rf /var/lib/apt/lists/*
ENV LC_ALL=C
