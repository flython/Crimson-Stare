# WebSocket 通信协议 v1

server ↔ web 的通信契约。02 号票据定稿的引擎抽象（`reduce` 纯函数 + `redactState`）是本协议的执行基础。

## 总原则

1. **服务端权威**：客户端只发意图（Action），状态只存在于 server 内存中的引擎实例。
2. **全量快照广播**：每次状态变更后，server 对每个连接调用 `redactState(state, viewerId)` 裁剪私密区，推送**全量**裁剪后快照。不做 diff——内部局快照 <50KB，全量省去一致性难题，断线重连天然复用同一机制。
3. **可见性执行点**：只在 server 分发层（广播前）裁剪，引擎不感知"谁能看到什么"。

## 消息类型表

### 客户端 → 服务端（JSON，`{ type, ... }`）

| type | 载荷 | 说明 |
|---|---|---|
| `hello` | `{ name, token? }` | 连接后首条消息。token 缺失则为新身份，server 下发新 token |
| `createRoom` | `{ config }` | 创建房间，返回 `roomId` + 分享链接 |
| `joinRoom` | `{ roomId }` | 以当前身份加入房间 |
| `updateConfig` | `{ config }` | 房主修改开局配置（未开始时） |
| `startGame` | `{}` | 房主开始游戏 |
| `action` | `{ action }` | 提交引擎 Action（换牌/出牌/宣告/购买/删除/重整等，形状由 engine `Action` 类型定义） |
| `ready` | `{}` | 同步型阶段（出牌/宣告）的就绪确认 |
| `reconnect` | `{ token, roomId }` | 断线后重连，凭 token 恢复座位 |

### 服务端 → 客户端

| type | 载荷 | 说明 |
|---|---|---|
| `welcome` | `{ playerId, token }` | hello 应答，token 由客户端持久化到 localStorage |
| `roomState` | `{ room }` | 房间 lobby 状态（成员/配置/座位） |
| `snapshot` | `{ state, you }` | 全量裁剪快照。`you` 是观察者座位号，客户端据此渲染"我的视角" |
| `log` | `{ entries }` | 结算/宣告日志流（公开信息，不裁剪） |
| `error` | `{ code, message }` | Action 非法 / 未轮到你 / 房间不存在等 |

## 时序

### 正常对局

```
client A          server                       client B
   │ action ───────▶│                              │
   │                │ reduce(state, action)        │
   │                │ 校验失败 ──▶ error(仅A)       │
   │                │ 成功 ──▶ snapshot(redact,A)   │
   │◀── snapshot ────│── snapshot(redact,B) ───────▶│
   │◀── log ────────│── log ──────────────────────▶│
```

### 断线重连

```
client (重连)      server
   │ hello(name) ──▶│ 新连接，返回 welcome+新token（旧token仍在座位表）
   │ reconnect ────▶│ 校验 token → 命中座位
   │◀── snapshot ───│ 全量恢复（含托管状态标记）
```

- token 校验失败：座位保留但视为离线，进入托管。
- 房间不存在/已结束：error，回到大厅。

## 托管规则（已确认）

| 触发 | 行为 |
|---|---|
| 连接断开 | 立即进入托管 |
| 在线但超时 | 阻塞型阶段（出牌/宣告/确认选择）超时 **120s**（全局配置 `config/game-config.json`，不做每房配置）自动托管 |

托管执行 = **最小操作原则**：不换牌（阶段结束自动兑换血筹）、出系统判定的最大牌型（不发动可选技能/芯片）、不购买、不删牌、重整选获得 2 血筹。重连接管后托管自动解除，未执行的选择重新交还玩家。

## 房间生命周期（已确认）

```
创建(内存) → 配置/加入 → 开始 → 对局 → 有人达标 = 结束
                                    └─▶ 写 SQLite 局摘要后房间销毁
```

- 房间**只存内存**；**仅游戏结束时写一局摘要**进 SQLite（胜负/各回合结算/时长），不做逐 Action 回放。
- 中途关服 = 丢局，内部可接受（已确认）。
- server 启动时建表 `game_records(id, mode, player_count, started_at, ended_at, winner, summary_json)`。
