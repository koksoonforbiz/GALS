# GALS Studio as a single container (server + built web on one port).
#
# Studio has NO login: publish it on the host's loopback only and reach it
# through an SSH tunnel, never on a public interface:
#   docker run -d --name gals-studio --restart unless-stopped \
#     -p 127.0.0.1:15174:5174 \
#     -v ~/gals/studio-data:/data -v ~/gals/exports:/bundles:ro gals-studio:latest
#   ssh -L 15174:127.0.0.1:15174 <host>   →   http://localhost:15174
#
# Data (studio.db + media/) lives in /data; migrations run at start.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /studio
# The desktop (Electron) workspace is not used in a container.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/studio-server/package.json apps/studio-server/
COPY apps/studio-web/package.json apps/studio-web/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --no-audit --no-fund

COPY packages packages
COPY apps/studio-server apps/studio-server
COPY apps/studio-web apps/studio-web
RUN npm -w @gals-studio/shared run build \
  && npm -w @gals-studio/web run build \
  && cd apps/studio-server && npx prisma generate

ENV STUDIO_DATA_DIR=/data \
    STUDIO_DATABASE_URL=file:/data/studio.db \
    STUDIO_HOST=0.0.0.0 \
    STUDIO_PORT=5174
WORKDIR /studio/apps/studio-server
EXPOSE 5174
CMD ["sh", "-c", "mkdir -p /data/media && npx prisma migrate deploy && exec npx tsx src/index.ts"]
