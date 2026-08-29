# 04 - WebSocket 同步协议与重连托管设计

Type: grilling
Status: resolved
Blocked by: 02

## Question

server ↔ web 的通信契约要一次定对：

- 消息 schema：客户端操作消息与服务端广播（全量快照 vs diff）的取舍；多端同阶段并发的"就绪推进"模型；
- 视野过滤：手牌/弃牌区私密信息在广播时如何按玩家裁剪（服务端权威的直接后果）；
- 重连：昵称+localStorage 令牌的握手流程、重连后的全量快照恢复；
- 托管：掉线检测、120s 超时可配置、最小操作原则的规则映射、重连接管；
- 房间生命周期：创建/配置/加入/开始/结束/存 SQLite 的时机。
- 产出：协议文档（消息类型表+时序图）入库，作为 server 与 web 的契约。

## Answer

三个决策经飞飞确认（2026-08-29），协议文档入库：`docs/protocol.md`（server 与 web 的契约，04 的产出物）。

1. **全量快照**：每次 Action 后按连接推送 `redactState` 裁剪后的全量快照，不做 diff。重连即"再发一次快照"，机制复用。可见性执行点只在 server 分发层。
2. **托管**：掉线立即托管；在线超时 120s（仅阻塞型阶段计时）托管。全局配置不做每房配置。最小操作原则（不换/出最大牌型/不购买/不删牌/重整拿2筹），重连接管解除、选择交还。
3. **房间生命周期**：房间只在内存；仅游戏结束时写一局摘要进 SQLite（无逐 Action 回放）；中途关服丢局可接受。

消息类型表：客户端 8 类（hello/createRoom/joinRoom/updateConfig/startGame/action/ready/reconnect），服务端 5 类（welcome/roomState/snapshot/log/error）。
