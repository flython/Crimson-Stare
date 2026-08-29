# 构建上下文必须是仓库根目录（web 依赖 @crimson/engine workspace）：
#   docker build -f packages/web/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/web packages/web
RUN npm run build -w @crimson/engine && npm run build -w @crimson/web

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 80
