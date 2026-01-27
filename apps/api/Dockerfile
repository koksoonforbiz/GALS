FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
RUN npm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS production
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]

FROM base AS development
ENV NODE_ENV=development
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npx", "nest", "start", "--watch"]
