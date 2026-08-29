# 15 - M2.6 简易模式 web 端联调

Type: task
Status: resolved
Blocked by: 11, 12, 14

## Question

简易模式（4 角色 + 24 黄边黑市牌）在 web 端完整可玩：server 建房/入房/推进 + 角色/黑市效果 + 交互 prompt 端到端跑通,验收一条完整对局。

## Notes

- 链路:web 创建/加入房间 → server 载入卡池(08) → createGame 注入角色与简易模式过滤 → 8 阶段推进(角色/黑市效果 11/12) → 交互 prompt 选择(13/14) → 结算发奖 → 终局。
- 验收:2 人简易局完整一回合(抽/换/出/决/结/购/删/整)不卡死,效果日志正确,交互选择可达。
- 协议按 04 号票据契约,`resolvePrompt` 需入协议。
- SQLite 终局摘要(04 票据)可顺带接通。
- 测试:server 层 WS 契约测试扩展 resolvePrompt;web 层手工验收清单。

## Answer

已按验收完成，三方（server / protocol / web）全部落地：

1. **协议定稿**（docs/protocol.md v1）：`resolvePrompt {choice}` 客户端消息，playerId 由 server 从连接推断；`createRoom` 载荷改 `{mode, config?}`（MVP 仅 easy）；日志随 `snapshot.state.log` 全量下发（取消增量）；错误码表、交互挂起时序图、托管规则同步更新。
2. **server 房间与协议**（packages/server/src/room.ts + index.ts）：内存 Map 房间模型（RoomManager+Room），处理 hello/createRoom/joinRoom/startGame/action/resolvePrompt/reconnect；redactState 按连接裁剪后广播全量 snapshot；简易模式开局从 4 张 simpleOnly 角色随机分配；prompt 超时（默认 60s）走 engine autoResolve，chooseCard 空选择兜底改选首候选（规避数值芯片 resolve 抛错卡死）；阶段级掉线托管提交默认 Action。
3. **集成测试**（packages/server/tests/ws-e2e.test.ts，4 用例全绿）：① 2 人简易局完整一回合（抽→换→出→决→结→购→删→整）+ 购买 001 校准器走完 pendingPrompt→resolvePrompt 断言芯片挂载；② promptTimeoutSec=1 超时自动托管；③ 错误路径（非房主 NOT_OWNER / 未 hello NEED_HELLO）；④ 断线重连 token 恢复座位。
4. **web 最小接线**（packages/web）：GameClient WS 封装（握手 + token localStorage 持久化）、简易大厅 Lobby（建房/入房/成员/房主开始）、牌桌快照渲染 Table（黑市购买/手牌阶段操作/PendingPromptBanner onResolve 接 WS/对局日志），App.tsx 三阶段路由接入；`npm run build -w @crimson/web` 通过；node 冒烟确认建房→入房→开局→snapshot 全链路打通。

**遗留（非阻塞，均未在本票据范围内动工）**：
- SQLite 局摘要仍未接通（终局以 snapshot.finished + winners 通知，标 M2 遗留）。
- `packages/card-data` 存在 pre-existing 构建失败（schemas.ts triggers `.default([])` 与 engine `CardDef.triggers` 必选类型不兼容，8b9b8b8 引入），与本次改动无关且不在改动范围，需单独票据处理。
- 黑市牌名暂以 defId 展示（server 未下发卡池元数据）；骰子动画未接（无骰子事件流）。
