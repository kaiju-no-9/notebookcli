FROM ubuntu:22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git python3 python3-pip unzip \
    && rm -rf /var/lib/apt/lists/*

# Use TLS for subsequent Ubuntu repository access once system CA certificates are installed.
RUN sed -i "s|http://ports.ubuntu.com|https://ports.ubuntu.com|g" /etc/apt/sources.list

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN useradd -m -u 1000 sandbox \
    && mkdir -p /home/sandbox/workspace \
    && chown -R sandbox:sandbox /home/sandbox
USER sandbox
WORKDIR /home/sandbox/workspace
