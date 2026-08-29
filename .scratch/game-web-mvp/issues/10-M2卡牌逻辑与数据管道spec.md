# 10 - M2 卡牌逻辑与数据管道 spec

Type: task
Status: ready-for-agent
Blocked by: 02, 06

## Problem Statement

《血色牌局》Web 版 M2 需要把 21 张角色牌 + 52 张黑市牌的效果**全部**落地到引擎，并让卡池数据可从 Excel 模板一键转换、启动时载入，方便后续改描述/新增卡牌不动代码。当前引擎只有白板局骨架（无角色/黑市效果），卡池 JSON 已由 08 号票据产出。

## Solution

玩家通过 Web（简易模式）游玩《血色牌局》：选择简易角色（4 张）后进入 8 阶段回合，角色技能与黑市牌效果按规则书生效，需要选目标/选牌的交互通过挂起机制等待玩家输入。卡池数据由 `config/card-pool-template.xlsx` 转换生成，server 启动时载入注入引擎。

## User Stories

1. 作为玩家，我想在简易模式中选择 4 张简易角色之一开局，以便角色技能生效。
2. 作为玩家，我想赌场荷官的【结算阶段】牌型总点数 +20 在对决比较中生效，以便赢得点数相当的对决。
3. 作为玩家，我想银行职员在游戏开始获得 2 血筹、每次重整阶段获得 2 血筹，以便获得稳定经济。
4. 作为玩家，我想魔术师的手牌上限 +1，以便有更大操作空间。
5. 作为玩家，我想酒保换牌次数 +1、剩余换牌次数归 0 时获得 1 血筹，以便更灵活换牌。
6. 作为玩家，我想在购买阶段购买黑市牌并立即生效（强化芯片插入弃牌堆牌、秘密交易立即结算、备用道具存入道具区），以便构筑牌库。
7. 作为玩家，我想购买校准器/限流阀后对应牌点数永久 ±N（2-14 范围校验），以便强化牌型。
8. 作为玩家，我想购买血筹镀层等需要选目标的效果时，桌面上高亮可选目标并等待我点击，以便完成交互。
9. 作为玩家，我想效果日志显示每步结算（获得/失去血筹、删除牌等），以便理解对局。
10. 作为维护者，我想修改 xlsx 模板并运行 `npm run cards:build` 后重启 server 即生效，以便改描述/加卡牌不动代码。
11. 作为维护者，我想转换脚本对重复 ID/必填空/非法时机段报硬错，以便数据错误在启动前暴露。
12. 作为维护者，我想未注册效果的卡牌降级为「无效果 + log」，以便新卡不阻塞对局。

## Implementation Decisions

- **效果注册表**：角色效果按 `roleId` 命名空间注册为 EffectDef（`source: "character"`），`resolveTiming` 对每个持有该角色的玩家生成队列条目（每玩家实例，非单一玩家）。
- **游戏开始 setup**：角色常驻/初始效果（魔术师手牌上限、赌场荷官对决点数、银行职员初始血筹、酒保换牌次数）由 `roleSetup` 注册表在 `createGame` 设置 characterId 时应用一次。
- **效果接入点**（whiteboard 扩展）：
  - 手牌上限 = `config.handLimit + (handLimitBonus ?? 0)`（抽牌时）；
  - 换牌次数 = `swapCountWithPass/swapCount + (swapBonus ?? 0)`（进入换牌阶段时）；
  - 对决总点数 = `evaluateHand().totalPoints + (duelPointsBonus ?? 0)`（对决排序前）；
  - 重整阶段进入时跑 `before` hooks（银行职员 +2 血筹）；
  - 换牌动作使 swapLeft 归 0 时触发动作钩子 `swapZero`（酒保 +1 血筹）。
- **交互机制**：`GameState.pendingPrompt: PendingPrompt | null`（同一时刻最多 1 个挂起），`PendingPrompt = choosePlayer | chooseCard`；新 Action `resolvePrompt` 由 reducer 消费后继续原效果；`rollDice` 服务端直接掷（无 UI 交互）。效果执行遇到需输入时写入 pendingPrompt 并返回，等待客户端输入。
- **超时策略**：`game-config.json` 新增 `promptTimeoutSec`（默认 60）与 `timeoutPolicy: "auto" | "strict"`；auto=超时随机选目标/默认不选并提示。
- **简易模式过滤**：`createGame(config, pool, { simple: true })` 时黑市仅取 `yellowBorder === true`（24 张）、角色仅取 `simpleOnly === true`（4 张）。
- **UI 交互组件**（4 个，接 server 推送的 `stateUpdate.pendingPrompt`）：`TargetPicker`（选玩家）、`CardPicker`（选牌，支持多选）、`PendingPromptBanner`（等待提示）、`DiceRollAnimation`（骰子动画）。
- **占位卡**：图片缺失时保留纯色块占位 + 叠加效果原文（半透明文字条）。
- **web 入口**：M2 只开放简易模式；标准模式/单人模式入口灰显「敬请期待 M3」。

## Testing Decisions

- 主 seam = engine 公开 API（纯函数状态机），不测 UI。
- 角色/黑市效果单测：`createGame` 建局 → 注入角色/购买黑市牌 → 逐 Action 推进 → 断言 state（血筹/车票/牌区/日志）。
- 交互机制单测：效果触发后断言 `pendingPrompt` 形状 → 发 `resolvePrompt` → 断言效果继续。
- 转换脚本回归：结构层（zod）+ 业务层（重复 ID/必填空/非法枚举/超界数值/错列名）双套 fixture。
- 既有先例：`packages/engine/tests/primitives.test.ts`、`packages/card-data/tests/build.test.ts`。

## Out of Scope

- 事件牌 handler（36 张）、命运牌 handler（15 张）+ 机械荷官 3 张 AI（M3）。
- 标准模式 web 入口开放（仅灰显）、单人模式。
- 捣蛋鬼 / 组队 / 暗藏杀机 / 暗拍 / 拍卖 / 复杂多轮交互。
- 反作弊、账号系统。

## Further Notes

- 规则权威：`docs/血色牌局_规则书.md`（21 页 OCR 校订）。设计细节：`docs/卡牌逻辑设计.md`（含工作分解 §7 与关键文件清单 §8）。
- 提交规范：commit message 用中文有序列表。
- 分批节奏（grilling Q7）：简易模式全集（4 角色 + 24 黄边）先行可玩，标准模式全集随后补齐注册。
- 已完成铺垫：issue 08（数据管道）、09（效果原语库）；本 spec 是后续 issue 11-15 的执行蓝本。
