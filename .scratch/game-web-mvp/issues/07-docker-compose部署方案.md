# 07 - docker-compose 部署方案

Type: task
Status: open
Blocked by: 01

## Question

部署形态要早定，避免 server/web 各自长歪：

- 双服务 compose：`web`（nginx 静态 + 反代 `/ws` 到 server）、`server`（Node）；SQLite 数据卷位置与备份假设；
- 构建产物：monorepo 各包 build 输出如何进镜像（多阶段构建，镜像里不带 devDependencies）；
- 环境配置：端口、奖励表配置文件挂载路径（奖励表可调是硬需求，配置必须能不改镜像热改）；
- 产出：可用的 `docker-compose.yml` + 两个 Dockerfile + 部署说明入库，本地 `docker compose up` 能跑通空服务。

## Answer

（待解决）
