FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
# See apps/api/Dockerfile — keep Corepack on the activated pnpm.
ENV COREPACK_DEFAULT_TO_LATEST=0
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

# Sources + deps, no build yet — shared by the single-bundle `build`
# stage below and the two-door stage at the bottom of this file.
FROM base AS web-src
COPY apps/web/package.json ./
COPY apps/web/scripts ./scripts
RUN echo "shamefully-hoist=true" > .npmrc
RUN sed -i '/"@ats\/config"/d' package.json && sed -i '/"@ats\/shared"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN node -e "const p=require('./package.json');p.pnpm={onlyBuiltDependencies:['esbuild']};require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN pnpm install
COPY --from=shared-build /repo/packages/shared /shared
RUN pnpm add /shared
COPY apps/web/ .

FROM web-src AS build
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

# ── Two-door image (docs/two-door/, docker-compose.twodoor.yml) ─────────
# One nginx serving BOTH doors on separate ports: the student bundle
# (dist-student, /api default-deny allowlist) and the admin bundle
# (dist-admin, full /api). nginx config is rendered from
# deploy/nginx/templates by the image's envsubst entrypoint; only
# ${GALS_*} variables are substituted (NGINX_ENVSUBST_FILTER).
FROM web-src AS twodoor-build
RUN pnpm run build:student && pnpm run build:admin

FROM nginxinc/nginx-unprivileged:1.30-alpine AS twodoor
USER root
RUN rm -f /etc/nginx/conf.d/default.conf \
    && mkdir -p /var/www/certbot /etc/nginx/certs /etc/nginx/gals \
    && chown -R nginx:nginx /var/www/certbot /etc/nginx/certs /etc/nginx/gals
USER nginx
COPY --from=twodoor-build --chown=nginx:nginx /app/dist-student /usr/share/nginx/html/student
COPY --from=twodoor-build --chown=nginx:nginx /app/dist-admin   /usr/share/nginx/html/admin
COPY --chown=nginx:nginx deploy/nginx/templates/ /etc/nginx/templates/
COPY --chown=nginx:nginx deploy/nginx/snippets/  /etc/nginx/gals/snippets/
# Local default; docker-compose.twodoor.yml bind-mounts the real file over it.
COPY --chown=nginx:nginx deploy/nginx/admin-access.local.conf /etc/nginx/gals/admin-access.conf
ENV NGINX_ENVSUBST_FILTER=^GALS_
EXPOSE 8080 8443 9443
