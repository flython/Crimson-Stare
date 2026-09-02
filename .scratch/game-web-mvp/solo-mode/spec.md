# Spec: 单人模式 — 入口与结算 (Issue #34)

Status: ready-for-agent

## Overview

单人模式：玩家 vs 机械荷官（Doloris / Timoris / Mortis 三选一），沿用简易模式规则 + 2 人局标准，目标 24 票。

## Rules Summary

- 2 人局（玩家 + 荷官），目标 24 票
- 玩家默认持【临时特权证】+ 2 血筹（规则 §12）
- 荷官血筹无限、效果优先（荷官是 NPC，效果优先指优先于玩家）
- 玩家率先达 24 票 → 胜利；荷官先达 24 票 → 失败（票据 38）
- 荷官自动出牌（`bestPlayCards`），自动购买（贪心策略）

## Implementation

### 1. Mode 类型扩展 (`room.ts`)

```ts
export type Mode = "easy" | "standard" | "solo";
```

### 2. 服务端建房 (`handleCreateRoom`)

- `mode=solo` 时允许建房
- 携带 `dealer: "Doloris" | "Timoris" | "Mortis"` 参数
- 创建 Room 时将 dealer 作为第二个 seat 注入（无需 WebSocket）

### 3. 荷官 NPC 注入 (`Room.start`)

solo 模式：`Room.start()` 在 `seats` 中加入荷官 seat：

```ts
// 荷官 NPC seat（无 socket）
{ playerId: "dealer", name: dealerName, characterId: null, socket: null, connected: true }
```

荷官角色按 `dealer` 选择：
- Doloris = 默认荷官（无特殊能力）
- Timoris = 效果待定（占位）
- Mortis = 效果待定（占位）

### 4. Engine 修改 (`whiteboard.ts`)

#### `createGame` solo 分支

```ts
opts: { simple?: boolean; solo?: boolean; dealerCharacterId?: string }
```

solo 模式：
- 玩家 chips = 2（持证者初始）
- 荷官 chips = Infinity（或 Number.MAX_SAFE_INTEGER）
- 玩家默认持证（`passHolderSeat = 玩家座位`）
- 不掷骰决定特权证（玩家直接持证）

#### `checkVictory` solo 分支

```ts
if (state.solo) {
  const player = state.players.find(p => !p.isDealer);
  const dealer = state.players.find(p => p.isDealer);
  if (dealer.tickets >= goal) {
    state.winners = [dealer.id]; // 荷官赢 = 玩家输
    state.finished = true;
  } else if (player.tickets >= goal) {
    state.winners = [player.id];
    state.finished = true;
  }
} else {
  // 原有逻辑
}
```

#### 荷官 NPC 标记

在 `PlayerState` 中加入 `isDealer?: boolean` 字段（通过 `createGame` 注入）。

### 5. 荷官自动操作

#### 出牌阶段 (`bestPlayCards`)

已实现于 `room.ts` 的 `autoActionFor` —— `play` 分支使用 `bestPlayCards`。
单人模式荷官始终在线（无连接断开），由 `armTimers` 阶段级托管驱动。

#### 购买阶段 (`autoActionFor`)

```ts
case "purchase": {
  // 贪心：选最贵的可购买栏位
  const affordable = state.blackMarket.slots
    .map((slot, idx) => ({ slot, idx }))
    .filter(({ slot }) => slot.defId && p.chips >= slot.price);
  if (affordable.length === 0) return { type: "skipPurchase", playerId: p.id };
  // 按 price + bonusChips 总和降序排列，选最贵的
  affordable.sort((a, b) =>
    (b.slot.price + b.slot.bonusChips) - (a.slot.price + a.slot.bonusChips)
  );
  return { type: "purchase", playerId: p.id, slotIndex: affordable[0].idx };
}
```

### 6. Lobby.tsx 修改

solo 入口（mode card）开放，显示三荷官选项供建房前选择。

```tsx
// solo 模式的 LobbyProps 扩展
interface LobbyProps {
  // ...
  /** solo 模式时需要选择荷官 */
  onCreateSolo?: (dealer: string) => void;
}
```

solo 模式建房流程：
1. 点击单人模式 → 进入荷官选择界面（三选一）
2. 选择荷官后 → 连接服务器并发送 `createRoom { mode: "solo", dealer }`
3. 进入 Lobby（solo 模式显示荷官名称，不显示"等待房主开始"）

### 7. App.tsx 修改

```tsx
// stage "conn" 分支支持 solo mode
{stage === "conn" && mode === "solo" ? (
  <DealerSelectForm
    name={name}
    setName={setName}
    wsUrl={wsUrl}
    setWsUrl={setWsUrl}
    onConfirm={(dealer) => {
      // 保存 dealer 到 state
      setDealer(dealer);
      connect(); // 连接服务器
    }}
    onBack={() => setStage("mode")}
  />
) : null}
```

连接后发送 `createRoom { mode: "solo", dealer }`。

### 8. Victory 结算展示

服务端终局快照中 `state.winners` 包含胜者 ID。

- 玩家胜：`winners = [玩家ID]` → 显示"胜利"
- 荷官胜：`winners = ["dealer"]` → 显示"失败"
- 平局不可能（规则 §8）

Web 侧 Table 组件在 `state.finished === true` 时在游戏日志区显示大字结算横幅（红色"失败"或金色"胜利"）。

## Testing

- e2e：单人完整对局（从建房到 24 票结算）
- 胜负判定：玩家先达 24 → 胜；荷官先达 24 → 负
- 荷官血筹无限（任意购买不耗尽）
- 断线重连不适用于荷官（NPC 始终在线）

## Out of Scope

- 荷官特殊能力（Doloris/Timoris/Mortis 差异化效果）—— 占位符阶段，后续票处理
- 命运牌库（票据 33）
- 荷官选牌 AI 优化（贪心购买足够满足 MVP）
