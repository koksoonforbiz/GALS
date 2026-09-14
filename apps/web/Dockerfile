FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app

FROM base AS shared-build
WORKDIR /repo
COPY tsconfig.base.json ./
WORKDIR /repo/packages/shared
COPY packages/shared/package.json ./
RUN echo "shamefully-hoist=true" > .npmrc
RUN sed -i '/"@ats\/config"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN pnpm install
COPY packages/shared/ ./
RUN pnpm run build

FROM base AS development
COPY apps/web/package.json ./
COPY apps/web/scripts ./scripts
RUN echo "shamefully-hoist=true" > .npmrc
RUN sed -i '/"@ats\/config"/d' package.json && sed -i '/"@ats\/shared"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN node -e "const p=require('./package.json');p.pnpm={onlyBuiltDependencies:['esbuild']};require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN pnpm install
COPY --from=shared-build /repo/packages/shared /shared
RUN pnpm add /shared
COPY apps/web/ .
EXPOSE 5173
CMD ["pnpm", "exec", "vite", "--host"]

FROM base AS build
COPY apps/web/package.json ./
COPY apps/web/scripts ./scripts
RUN echo "shamefully-hoist=true" > .npmrc
RUN sed -i '/"@ats\/config"/d' package.json && sed -i '/"@ats\/shared"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN node -e "const p=require('./package.json');p.pnpm={onlyBuiltDependencies:['esbuild']};require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN pnpm install
COPY --from=shared-build /repo/packages/shared /shared
RUN pnpm add /shared
COPY apps/web/ .
RUN pnpm run build

# Pinned (checklist item 24) — was the rolling `alpine` tag.
# `nginx-unprivileged` (not plain `nginx`) — pre-built to run as a
# non-root user out of the box (checklist item 50 / CIS Docker
# Benchmark 4.1), rather than hand-patching pid/temp-dir paths onto
# the root-oriented official image. Listens on 8080, not 80 — see
# nginx.conf's comment (non-root can't bind ports below 1024).
FROM nginxinc/nginx-unprivileged:1.30-alpine AS production
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
COPY --chown=nginx:nginx apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
