# Spec: 项目 README

2026-08-31 grilling 定稿（飞飞确认「全部按推荐」）。

## 决策

- **读者**：内部协作者/未来的自己——clone 后能跑起来、知道去哪找文档；不做对外卖点页。
- **语言**：中文（与仓库现有文档一致）。
- **位置**：仓库根一份 `README.md`，各 package 不单发。
- **结构**（6 节全保留）：
  1. 项目简介：一段话（桌游 Web 数字化、三种玩法、服务端权威）+ 规则书链接
  2. 快速开始：环境要求（Node ≥22）、install → build → dev 命令、卡池管道
  3. Docker 部署：compose 命令、8088 端口、双服务与卷/配置挂载说明
  4. 目录结构：四包 + config/assets/docs/.scratch 一句话职责
  5. 文档索引：规则书/卡牌逻辑设计/protocol/spec/map/票据 链接表
  6. 测试与构建：根级脚本 + 测试 seam 一句话
- **进度**：写一行当前状态（简易模式可玩、标准/单人开发中），不写 M3' 细节流水账。
- **装饰**：不放截图、不放 badge。

## 事实锚点（写作前已核实）

- 本地 dev 首次需 `npm run build`：server 依赖 `@crimson/engine` 的 dist 产物（engine exports 指向 `dist/index.js`；server/web 两个 Dockerfile 都是先 build engine 再 build 自身；仅 web 有 dev 源码 alias）。
- 端口：server WS `:8080`（vite 将 `/ws` 代理过去）；web dev `:5173`；compose web 对外 `${WEB_PORT:-8088}`。
- `config/game-config.json`：奖励表 rankRewards、票数目标 ticketGoals、手牌上限/换牌次数等回合参数，只读挂载进容器，改后重启生效。
- 卡面图片：根 `assets/cards` 经 `sync-assets.mjs`（predev/prebuild 自动）同步进 web `public/cards`。
