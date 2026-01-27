FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app

FROM base AS deps
COPY package.json ./
RUN sed -i '/"@ats\/config"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN pnpm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

FROM base AS production
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]

FROM base AS development
ENV NODE_ENV=development
COPY package.json ./
RUN sed -i '/"@ats\/config"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN pnpm install
COPY . .
EXPOSE 3000
CMD ["pnpm", "exec", "nest", "start", "--watch"]
