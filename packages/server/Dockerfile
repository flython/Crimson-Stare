# 构建上下文必须是仓库根目录（server 依赖 @crimson/engine workspace）：
#   docker build -f packages/server/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
RUN npm ci || npm install
COPY packages/engine packages/engine
COPY packages/server packages/server
RUN npm run build -w @crimson/engine && npm run build -w @crimson/server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# 内部部署从简：整树拷贝（含源码与 devDependencies），体积换稳妥，后续可精简
COPY --from=build /app ./
EXPOSE 8080
CMD ["node", "packages/server/dist/index.js"]
