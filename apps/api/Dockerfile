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

FROM base AS deps
COPY apps/api/package.json ./
RUN echo "shamefully-hoist=true" > .npmrc
RUN sed -i '/"@ats\/config"/d' package.json && sed -i '/"@ats\/shared"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN pnpm install
COPY --from=shared-build /repo/packages/shared /shared
RUN pnpm add /shared

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api/ .
RUN pnpm exec prisma generate
RUN pnpm exec nest build

FROM base AS production
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
# Checklist item 4 — opt-in encrypted-.env-at-rest support. Only the
# plain scripts/ (no NestJS deps, doesn't need building) and the
# entrypoint are needed; fully inert unless ENV_MASTER_KEY is set at
# runtime — see docker-entrypoint.sh and scripts/decrypt-env-boot.mjs.
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node --chmod=755 /app/docker-entrypoint.sh ./
# Checklist item 50 (CIS Docker Benchmark 4.1 — don't run as root).
# `node` (uid 1000) ships pre-created in the official node:alpine
# image. Production-only: the `development` stage below is untouched
# since it's what docker-compose.yml actually runs today and a
# root-vs-non-root permission issue there can't be verified without a
# live stack.
USER node
EXPOSE 3000
CMD ["sh", "docker-entrypoint.sh"]

FROM base AS development
ENV NODE_ENV=development
COPY apps/api/package.json ./
RUN echo "shamefully-hoist=true" > .npmrc
RUN sed -i '/"@ats\/config"/d' package.json && sed -i '/"@ats\/shared"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN pnpm install
COPY --from=shared-build /repo/packages/shared /shared
RUN pnpm add /shared
COPY apps/api/ .
RUN pnpm exec prisma generate
RUN chmod +x start-dev.sh
EXPOSE 3000
CMD ["sh", "start-dev.sh"]
