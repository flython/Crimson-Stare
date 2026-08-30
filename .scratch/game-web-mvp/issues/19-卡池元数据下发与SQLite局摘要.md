# 19 - 卡池元数据下发与 SQLite 局摘要

Type: task
Status: resolved
Blocked by: —

## Answer

两项均已落地，server 8 用例全绿（新增 2）、build/lint 通过。

**卡池元数据下发**：
- 新增 `ServerMessage { type: "cardPool", pool: CardPool }`：hello → welcome 后随一次下发完整 CardPool（roles/market/fate/events 的 CardDef，含 name/colorTag/effectText/image），静态数据不随状态重发。协议文档 `docs/protocol.md` 已更新。
- web 侧 `App.tsx` 存 pool state，`Table.tsx` 建 `roleById`/`marketById` 查找表：黑市卡显示卡名+效果文本（title 悬停全文）、分类边框改按 colorTag 三分类（cat-green 牌型绿 / cat-blue 容错蓝 / cat-red 互动暗红，无 colorTag 回退 subtype 映射）；座位角色卡显示角色名（悬停显示 名·称号：技能文本）；操作台角色名、道具区、芯片概览同步替换 defId。元数据未到时全部回退 defId 降级显示。

**SQLite 局摘要**：
- 新增 `packages/server/src/db.ts`：`SummaryStore` 用 Node 内置 `node:sqlite`（零依赖；因 Vite/Vitest 内建清单未收录该模块，通过 `process.getBuiltinModule` 运行时获取，不写 import 语句）。DB_PATH（compose 已设 `/data/crimson.db`）未配置时为 no-op 禁用态。
- `Room` 记录 startedAt，`afterStateChange` 终局时写一条 `game_records(id, mode, player_count, started_at, ended_at, winner, summary_json)`，summaryJson 含回合数、胜者昵称、各玩家终局票/筹/角色。
- e2e 新增 2 用例：hello 下发 cardPool（断言 21 角色/52 黑市/001 芯片字段齐全）；ticketGoals=4 快局打完 → 断言 finished 广播 + 落库行字段正确。

## Question

1. server 向客户端下发卡池元数据（黑市牌名、分类、效果文本、角色技能文本），web 全部替换 defId 裸显示（黑市卡名、座位角色名/技能 tooltip、芯片详情的数据源）。
2. 顺带清 M2 遗留：牌局终局写 SQLite 局摘要（`/data` 卷持久化，spec 既定承诺）。

## Notes

- 元数据随 hello/startGame 快照或独立消息下发一次即可，卡池是静态数据，无需每回合重发。
- web 侧建元数据 store（context/zustand 现有技术栈内取最简）。
- SQLite 摘要字段：房号、模式、玩家人数/昵称、起止时间、最终排名（票/筹）、回合数；引擎终局事件已有钩子可挂。
