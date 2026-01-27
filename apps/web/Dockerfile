FROM node:20-alpine AS base
WORKDIR /app

FROM base AS development
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npx", "vite", "--host"]

FROM base AS build
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
