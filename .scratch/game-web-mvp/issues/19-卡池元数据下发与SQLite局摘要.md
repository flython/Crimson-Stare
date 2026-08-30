# 19 - 卡池元数据下发与 SQLite 局摘要

Type: task
Status: open
Blocked by: —

## Question

1. server 向客户端下发卡池元数据（黑市牌名、分类、效果文本、角色技能文本），web 全部替换 defId 裸显示（黑市卡名、座位角色名/技能 tooltip、芯片详情的数据源）。
2. 顺带清 M2 遗留：牌局终局写 SQLite 局摘要（`/data` 卷持久化，spec 既定承诺）。

## Notes

- 元数据随 hello/startGame 快照或独立消息下发一次即可，卡池是静态数据，无需每回合重发。
- web 侧建元数据 store（context/zustand 现有技术栈内取最简）。
- SQLite 摘要字段：房号、模式、玩家人数/昵称、起止时间、最终排名（票/筹）、回合数；引擎终局事件已有钩子可挂。
