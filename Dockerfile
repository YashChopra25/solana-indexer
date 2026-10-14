# Production image: the same base as Dockerfile.dev, but the source is baked in
# and the console is built once, so nothing is bind-mounted or recompiled at
# run time. One image serves all three services (web, worker, migrate).
FROM node:22-bookworm-slim

# LaserStream is gRPC over TLS; the slim image has no root certificates.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
# `npm install` rather than `npm ci` for the reason given in Dockerfile.dev.
# Dev dependencies stay: the worker and migrations run through tsx.
RUN npm install --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
RUN npm run build

EXPOSE 8003

CMD ["npm", "start", "--", "-H", "0.0.0.0"]
