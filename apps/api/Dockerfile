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
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "dist/main"]

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
