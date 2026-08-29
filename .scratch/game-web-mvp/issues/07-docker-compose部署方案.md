# 07 - docker-compose 部署方案

Type: task
Status: resolved
Blocked by: 01

## Question

部署形态要早定，避免 server/web 各自长歪：

- 双服务 compose：`web`（nginx 静态 + 反代 `/ws` 到 server）、`server`（Node）；SQLite 数据卷位置与备份假设；
- 构建产物：monorepo 各包 build 输出如何进镜像（多阶段构建，镜像里不带 devDependencies）；
- 环境配置：端口、奖励表配置文件挂载路径（奖励表可调是硬需求，配置必须能不改镜像热改）；
- 产出：可用的 `docker-compose.yml` + 两个 Dockerfile + 部署说明入库，本地 `docker compose up` 能跑通空服务。

## Answer

**部署形态**：`docker-compose.yml` 双服务。

- `web`：多阶段构建（node:22-alpine 构建 engine+web → nginx:1.27-alpine 托管 dist），nginx 反代 `/ws` → `server:8080`（Upgrade 头透传，读超时 3600s），SPA `try_files` 回退。对外端口 `${WEB_PORT:-8088}:80`。
- `server`：多阶段构建（构建后整树拷贝运行，内部部署从简换稳妥），SQLite 数据卷 `server-data:/data`（`DB_PATH=/data/crimson.db`），配置只读挂载 `./config:/app/config:ro`。

**配置热改（硬需求已满足）**：奖励表/目标票数等全部在 `config/game-config.json`，server 经 `CONFIG_PATH` 加载，缺失字段回退内置默认值（`packages/server/src/config.ts`）。改配置后 `docker compose restart server` 生效，不换镜像。

**验证记录**（本机 Docker 29.4.3 + Compose v5.1.3 实测）：
1. `docker compose build` 双镜像构建成功（期间修复 engine 的 TS 闭包收窄 never 报错，见 hand-evaluator.ts `best` 对象引用改造）；
2. `docker compose up -d` 双容器启动正常；
3. curl 验证 SPA 页面（血色牌局 index.html）与 `/ws` 路由可达；
4. WS 客户端实测 `ws://localhost:8088/ws` 握手成功，收到 `{"type":"hello","engineVersion":"0.1.0"}`，server 日志显示配置文件加载生效（2人局目标 24 票）；
5. `docker compose down` 清理正常。

**遗留**：server 运行镜像目前含 devDependencies（注释已标明），正式对外前可再做产物精简；镜像发布到 registry 的流程不在 MVP 范围。
