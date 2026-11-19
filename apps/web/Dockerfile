FROM node:24-alpine AS base
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

# Pinned (checklist item 24). Runs as the non-root `nginx` user
# (checklist item 50 / CIS Docker Benchmark 4.1); listens on 8080, not
# 80 — see nginx.conf's comment (non-root can't bind ports below 1024).
#
# Built on the official image with the same patches the
# nginx-unprivileged image applies (no `user` directive, pid and temp
# dirs under /tmp, nginx-owned /etc/nginx and cache), because that image
# lagged the 2026-11-18 security release: 1.30.7 fixes CVE-2026-123007
# (HTTP/2 flow control), CVE-2026-118899 (TLS 1.3 request-body loop),
# CVE-2026-123633 (HTTP/2 UAF), CVE-2026-123634 (resolver UAF) and
# others; 1.30.6 is vulnerable (https://nginx.org/en/security_advisories.html).
# Bump the patch version here at the next nginx security release.
FROM nginx:1.30.7-alpine AS nginx-base
# Temp paths are http-level, so they go in conf.d (included inside http {}).
RUN sed -i 's,listen       80;,listen       8080;,' /etc/nginx/conf.d/default.conf \
    && sed -i '/^user /d' /etc/nginx/nginx.conf \
    && sed -i 's,^pid .*,pid        /tmp/nginx.pid;,' /etc/nginx/nginx.conf \
    && printf '%s\n' \
       'proxy_temp_path       /tmp/proxy_temp;' \
       'client_body_temp_path /tmp/client_temp;' \
       'fastcgi_temp_path     /tmp/fastcgi_temp;' \
       'uwsgi_temp_path       /tmp/uwsgi_temp;' \
       'scgi_temp_path        /tmp/scgi_temp;' > /etc/nginx/conf.d/00-unprivileged-temp.conf \
    && chown -R nginx:0 /var/cache/nginx /etc/nginx \
    && chmod -R g+w /var/cache/nginx /etc/nginx
USER nginx

FROM nginx-base AS production
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

FROM nginx-base AS twodoor
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
