FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app

FROM base AS development
COPY package.json ./
RUN sed -i '/"@ats\/config"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN pnpm install
COPY . .
EXPOSE 5173
CMD ["pnpm", "exec", "vite", "--host"]

FROM base AS build
COPY package.json ./
RUN sed -i '/"@ats\/config"/d' package.json && sed -i 's/"workspace:\*"/"*"/g' package.json
RUN pnpm install
COPY . .
RUN pnpm run build

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
