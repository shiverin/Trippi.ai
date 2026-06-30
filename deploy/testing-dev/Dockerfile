FROM node:24-trixie-slim

WORKDIR /workspace

ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      build-essential \
      python3 \
    && rm -rf /var/lib/apt/lists/*

CMD ["node", "--version"]
