# 血色牌局 Web 版（crimson-stare）

桌游《血色牌局》的 Web 数字化：浏览器建房，WebSocket 实时对局，服务端权威状态机。规划支持标准局（2-4 人）、简易模式、单人模式三种玩法，规则以[规则书](docs/血色牌局_规则书.md)为唯一权威。

> 当前进度：**简易模式已可端到端游玩**（建房 → 四向牌桌对局 → 终局落库）；标准局与单人模式开发中，路线图见 [map.md](.scratch/game-web-mvp/map.md)。

## 快速开始

环境要求：Node.js ≥ 22。

```bash
npm install
npm run build        # 首次必跑：server 依赖 engine 的构建产物

npm run dev:server   # 终端 1：WebSocket 服务端，:8080
npm run dev:web      # 终端 2：Vite 前端，:5173（/ws 已代理到 8080）
```

浏览器打开 <http://localhost:5173> 建房游玩。

改了卡池模板（`config/card-pool-template.xlsx`）后重新生成卡池数据：

```bash
npm run cards:build  # xlsx → config/cards/*.json
npm run cards:check  # 只校验不写入
```

开发/构建前会自动把 `assets/cards` 卡面图片同步进 web（`sync-assets.mjs` 挂在 predev/prebuild，无需手动操作）。

## Docker 部署

```bash
docker compose up --build -d
```

访问 <http://localhost:8088>（换端口改 `WEB_PORT` 环境变量）。两个服务：

- **web**：nginx 托管前端静态资源并反代 WebSocket；
- **server**：游戏服务端，`./config` 只读挂载（改配置重启容器生效，不换镜像），终局摘要写入 `server-data` 卷中的 SQLite。

## 目录结构

| 路径 | 职责 |
| --- | --- |
| `packages/engine` | 游戏引擎：纯函数状态机、牌型判定/JOKER 求解、效果注册表、种子重放 |
| `packages/server` | WebSocket 服务端：房间管理、状态裁剪广播、掉线托管、SQLite 局摘要 |
| `packages/web` | React + Vite 前端牌桌 |
| `packages/card-data` | 卡池数据管道：xlsx 模板 → zod 校验 → `config/cards/*.json` |
| `config/` | 游戏配置（奖励表、票数目标、回合参数）与卡池 JSON（管道产物，入库） |
| `assets/` | 卡面图片等静态资源事实源 |
| `docs/` | 规则书、协议、卡牌逻辑设计 |
| `.scratch/` | 需求 spec 与开发票据（约定见 [issue-tracker](docs/agents/issue-tracker.md)） |

## 测试与构建

```bash
npm run build  # 全工作区构建（engine/server tsc，web vite）
npm run test   # 全工作区 vitest
npm run lint   # eslint
```

测试 seam：engine 公开 API（主）与 server WebSocket 消息契约（次），不在 UI 层测。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/血色牌局_规则书.md](docs/血色牌局_规则书.md) | 游戏规则唯一权威（另有 PDF） |
| [docs/卡牌逻辑设计.md](docs/卡牌逻辑设计.md) | 卡牌效果设计 |
| [docs/protocol.md](docs/protocol.md) | WebSocket 消息契约 |
| [.scratch/game-web-mvp/spec.md](.scratch/game-web-mvp/spec.md) | Web 版 MVP 设计共识（含 UI 交互决策） |
| [.scratch/game-web-mvp/map.md](.scratch/game-web-mvp/map.md) | 开发路线图与决策记录 |
| [.scratch/game-web-mvp/issues/](.scratch/game-web-mvp/issues/) | 开发票据 |
