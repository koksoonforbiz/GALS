FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app

FROM base AS shared-build
WORKDIR /repo
COPY tsconfig.base.json ./
WORKDIR /repo/packages/shared
COPY packages/shared/package.json ./
RUN sed -i '/"@ats\/config"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN pnpm install --shamefully-hoist
COPY packages/shared/ ./
RUN pnpm run build

FROM base AS development
COPY apps/web/package.json ./
RUN sed -i '/"@ats\/config"/d' package.json && sed -i '/"@ats\/shared"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN pnpm install --shamefully-hoist
COPY --from=shared-build /repo/packages/shared /shared
RUN pnpm add /shared
COPY apps/web/ .
EXPOSE 5173
CMD ["pnpm", "exec", "vite", "--host"]

FROM base AS build
COPY apps/web/package.json ./
RUN sed -i '/"@ats\/config"/d' package.json && sed -i '/"@ats\/shared"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN pnpm install --shamefully-hoist
COPY --from=shared-build /repo/packages/shared /shared
RUN pnpm add /shared
COPY apps/web/ .
RUN pnpm run build

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
