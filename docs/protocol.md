# WebSocket 通信协议 v1

server ↔ web 的通信契约。02 号票据定稿的引擎抽象（`reduce` 纯函数 + `redactState`）是本协议的执行基础。

## 总原则

1. **服务端权威**：客户端只发意图（Action / resolvePrompt），状态只存在于 server 内存中的引擎实例。
2. **全量快照广播**：每次状态变更后，server 对每个连接调用 `redactState(state, viewerId)` 裁剪私密区，推送**全量**裁剪后快照。不做 diff——内部局快照 <50KB，全量省去一致性难题，断线重连天然复用同一机制。
3. **可见性执行点**：只在 server 分发层（广播前）裁剪，引擎不感知"谁能看到什么"。
4. **日志随快照**：`snapshot.state.log` 即结算/宣告日志流（公开信息，全量下发），不单独发 `log` 增量消息——与全量快照原则一致，省去增量同步。

## 消息类型表

### 客户端 → 服务端（JSON，`{ type, ... }`）

| type | 载荷 | 说明 |
|---|---|---|
| `hello` | `{ name, token? }` | 连接后首条消息。token 缺失则为新身份，server 下发新 token |
| `createRoom` | `{ mode, config? }` | 创建房间。MVP 仅 `mode:"easy"`（标准/单人返回 `MODE_UNAVAILABLE`）；`config` 可部分覆盖引擎 GameConfig（如 `promptTimeoutSec`） |
| `joinRoom` | `{ roomId }` | 以当前身份加入房间 |
| `startGame` | `{}` | 房主开始游戏 |
| `action` | `{ action }` | 提交引擎 Action（换牌/出牌/购买/删除/重整等，形状由 engine `Action` 类型定义）。`playerId` 由 server 从连接身份注入，客户端不携带 |
| `resolvePrompt` | `{ choice }` | **交互挂起选择（15 号票据定稿）**：`choice` 为 `string`（choosePlayer）或 `string[]`（chooseCard，牌 id 数组）。`playerId` 同样由 server 从连接推断，映射为引擎 `{ type:"resolvePrompt"; playerId; choice }` Action |
| `reconnect` | `{ token }` | 断线后重连。与 `hello` 携带 token 等价：server 按 token 恢复身份 → 绑定原座位 → 补发 roomState + 快照 |
| `leaveRoom` | `{}` | **离开房间（16 号票据）**：对局未开始 → 移出座位（房主离开 = 解散房间，全体收到 `leftRoom`）；对局已开始 → 等同断开（座位保留 + 托管继续，可重连恢复） |

> 注：v1 草案中的 `updateConfig`（房主改配置）未实现，MVP 建房时一次性定配置；`ready` 语义由引擎 `ready` Action 承担（`action` 消息）。

### 服务端 → 客户端

| type | 载荷 | 说明 |
|---|---|---|
| `welcome` | `{ playerId, token }` | hello 应答，token 由客户端持久化到 localStorage |
| `cardPool` | `{ pool }` | **卡池元数据（19 号票据）**：welcome 后随 hello 下发一次（静态数据，不随状态重发）。`pool` 为完整 `CardPool`（roles/market/fate/events 的 CardDef：卡名/分类/效果文本/图片路径），客户端建 id→def 查找表渲染卡名、效果文本与分类色 |
| `roomState` | `{ room }` | 房间 lobby 状态（成员/配置/座位/开始与结束标记），成员进出/开局时全房间广播 |
| `snapshot` | `{ state, you }` | 全量裁剪快照。`you` 是观察者座位号（playerId），客户端据此渲染"我的视角"；`state` 为 `redactState(state, you)` 输出，含 `pendingPrompt`（目标玩家见完整候选，他人见 `{ kind, waitingFor, promptText }`）与 `log` |
| `leftRoom` | `{ reason }` | **已离开房间（16 号票据）**：`reason` 为 `"left"`（主动离开）/ `"ownerLeft"`（房主离开，房间解散）/ `"roomClosed"`。收到后客户端回大厅，可再建房 |
| `error` | `{ code, message }` | Action 非法 / 未轮到你 / 房间不存在等。错误码见下表 |

### 错误码

| code | 含义 |
|---|---|
| `BAD_JSON` / `UNKNOWN_TYPE` | 消息格式非法 |
| `NEED_HELLO` | 连接后未先 `hello` |
| `ROOM_NOT_FOUND` / `ROOM_FULL` / `ALREADY_IN_ROOM` / `ALREADY_STARTED` / `NOT_IN_ROOM` | 房间状态不匹配 |
| `NOT_OWNER` | 仅房主可开始游戏 |
| `MODE_UNAVAILABLE` | 标准/单人模式未开放 |
| `GAME_NOT_STARTED` / `NO_PROMPT` / `NOT_YOUR_TURN` | 对局阶段不匹配（含 pendingPrompt 只接受目标玩家） |
| `BAD_ACTION` | 引擎 `reduce` 拒绝（如非法牌型、血筹不足、非当前阶段） |

## 时序

### 正常对局

```
client A          server                       client B
   │ action ───────▶│                              │
   │                │ reduce(state, action)        │
   │                │ 校验失败 ──▶ error(仅A)       │
   │                │ 成功 ──▶ snapshot(redact,A)   │
   │◀── snapshot ────│── snapshot(redact,B) ───────▶│
```

### 交互挂起（resolvePrompt）

```
client A          server                       client B
   │ action:purchase ──▶│                              │
   │                │ 效果 run 写入 pendingPrompt      │
   │◀── snapshot(含完整候选) ── snapshot(仅 waitingFor) ─▶│
   │ resolvePrompt ─▶│ 校验目标玩家 → resolve 两段式    │
   │◀── snapshot ────│── snapshot ────────────────────▶│
   │ 超时未选择       │ promptTimeoutSec 后 engine      │
   │                  │ autoResolve 自动 resolve       │
```

### 断线重连

```
client (重连)      server
   │ hello(name, token) ▶│ 身份恢复 → 命中原座位
   │◀── welcome ─────────│
   │◀── roomState ───────│（若仍在房间）
   │◀── snapshot ────────│ 全量恢复（含托管状态标记）
```

- token 校验失败（token 不存在）：视为新身份。
- 房间不存在/已结束：error，回到大厅。

## 托管规则（15 号票据落地）

| 触发 | 行为 |
|---|---|
| 交互挂起超时 | pendingPrompt 超过 `config.promptTimeoutSec`（默认 60s）后，server 调引擎 `autoResolve(state)` 取默认选择并自动发 resolvePrompt（`timeoutPolicy:"auto"`；`"strict"` 不托管，可能卡死留人工介入） |
| 连接断开且正被等待选择 | 立即 autoResolve 托管，避免挂起卡死整局 |
| 连接断开的其他阶段 | 离线玩家未 `phaseReady` 超过 `config.autoPassTimeoutSec`（默认 120s）后提交该阶段默认 Action（最小操作原则：不换牌/出系统判定最优 5 张/不购买/不删牌/重整取 2 血筹） |
| 重连 | 座位恢复在线，托管定时器取消；未执行的选择重新交还玩家 |

## 房间生命周期（已确认）

```
创建(内存) → 配置/加入 → 开始 → 对局 → 有人达标 = 结束
                                    └─▶ 广播终局快照（房间保留供查看）
```

- 房间**只存内存**；**仅游戏结束时写一局摘要**进 SQLite（胜负/各回合结算/时长），不做逐 Action 回放。**（19 号票据已落地：server 用 Node 内置 `node:sqlite` 写 `DB_PATH`（compose 中 `/data/crimson.db`），未配置则不落库；终局以 `snapshot.state.finished + winners` 通知客户端）**
- 中途关服 = 丢局，内部可接受（已确认）。
- server 启动时建表 `game_records(id, mode, player_count, started_at, ended_at, winner, summary_json)`。
