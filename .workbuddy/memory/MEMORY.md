# crimson-stare 项目长期备忘

## 提交规范（硬性）
- commit message 必须使用中文有序列表（1. 2. 3.）描述变化。

## 工作流约定（硬性，2026-08-30 飞飞确认）
- **需求先文档化+票据化**：新需求/新功能必须先文档化（spec/设计文档）并票据化（`.scratch/<feature>/issues/NN-*.md`，Type/Status/Blocked by 齐全，ready-for-agent），claim 票据后才允许写实现代码。禁止跳过票据直接实现。
- **每个交付即提交**：完成一份文档或完成一个 issue(resolved)后立即 git commit，不允许攒批。
- **票据驱动**：wayfinder 地图是路线图，按 frontier 顺序 claim，Status 流转 open→claimed→resolved，解决后更新 map.md Decisions so far。
- 完整条款见 AGENTS.md「工作流要求（硬性约定）」。

## 血色牌局 Web 版
- spec：`.scratch/game-web-mvp/spec.md`，wayfinder 地图：`.scratch/game-web-mvp/map.md`（票据在 issues/）。
- MVP 范围：标准局 2-4 人、简易模式、单人模式（三机械荷官+15命运牌）；事件牌（含黑心商贩）、捣蛋鬼、组队、暗藏杀机全部排除。
- 架构：TS monorepo（engine/server/web）、服务端权威 WebSocket、SQLite 存牌局记录、docker-compose 双服务（nginx+Node）。
- 引擎效果系统：硬编码注册表，不做 DSL；卡池数据 JSON 化，图片按 ID→文件名热替换，占位卡渲染。
- 测试 seam：engine 公开 API（主）+ WS 消息契约（次），Vitest。
- UI：暗色牌桌，基色 #e9404b / #583c42 / #ffc840，横屏最优，触屏+鼠标。
- 奖励表配置化（2人局 4票/4筹；3人局 4票/2票2筹/4筹；4人局 4票/2票2筹/1票3筹/4筹）。
- 素材依赖：飞飞 M2 前给简易模式牌池文本（4角色+黄边黑市牌），M3 前确认命运牌文本。
## 卡牌逻辑（M2 决策 2026-08-30）
- 规则书整理：`docs/血色牌局_规则书.md`（21 页 OCR 校订，与引擎 PhaseId/Timing 对齐）。
- 设计文档：`docs/卡牌逻辑设计.md`（数据管道 + 效果系统 + 交互机制 + UI 4 组件 + 工作分解）。
- 数据管道：`packages/card-data/`（Node/TS，zod+SheetJS）→ `config/cards/{roles,market,fate,events}.json` + `manifest.json`。
- 载入模式：JSON 提交 git，server 启动时 `loadCardPool()` 注入 engine（与 GameConfig 同模式）。
- 效果原语库：`packages/engine/src/effects/primitives.ts`（gainChips/spendChips/disableSkill/...），同模式卡用工厂复用。
- 交互机制：`state.pendingPrompt: PendingPrompt | null` + `resolvePrompt` action + `choosePlayer/chooseCard/rollDice` 原语。
- UI 组件：`TargetPicker / CardPicker / PendingPromptBanner / DiceRollAnimation`（接 stateUpdate.pendingPrompt）。
- 全量范围：21 角色 + 52 黑市牌全注册（命运/事件数据入管道，handler 留 M3+）；未注册效果降级「无效果 + log」。

## 里程碑：M1 白板标准局 → M2 黑市+角色+简易模式 → M3 单人荷官。

## 票据 18-20 完成（2026-08-31）
- 18 卡牌图片上图（sync-assets + CardImg 占位回退）、19 元数据下发（hello→cardPool 消息 + SQLite 局摘要 node:sqlite）、20 效果真身化全部 resolved；map.md frontier = 21（芯片可视化）。
- 票据 20 关键架构沉淀：芯片判定视图候选集语义（ChipView.suitOptions/rankOptions/duplicate/asJoker，chipViewFromChips 构建、mergeChipView 与角色映射叠加）；特权证条件工厂 passHolderBonus（self 购买即结算/chip 结算对持有者、negate 若不持有）落地 018/019/020/037；跨玩家链式交互用 PendingPrompt.chooseCard.carry 中间态经 EffectContext.carry 回传（不污染 GameState）；负面状态字段 skipPhases/nextTurnSwapDelta/nextTurnSkillDisabled 由 whiteboard enterPhase 消费；purchase「购买先摘牌」保证效果看到的黑市不含刚买走的牌；from 联合类型 = ZoneId | "deck" | "market"。
- 引擎 155 用例全绿（engine 155 + card-data 15 + server e2e 8）。
- 票据 20 明确遗留（已标注 TODO）：道具 045-052 使用时结算（049 需效果响应栈）、芯片 014/015/016/023/024、035 黑厢抢夺（与 role:08 海盗留 M3 骰子交互）、role:05 特型演员/role:21 黑客（选牌交互）、role:15 特级大厨部分实现。
- role:11 吉祥物半价：代码 Math.floor（与卡面示例一致），规则书文字写「向上取整」——方向待飞飞核对。
- 卡面约束「不可插入【Joker牌】」：018-022 血筹镀层系五张均带，由 chipInstall 默认 noJoker=true 满足。
- 教训：429 限流中断时未落盘的编辑会丢失，恢复会话先 git status 核对工作区再继续。

## M2 完成（2026-08-30，票据 08-15 全部 closed）
- 数据管道(08)、效果原语库(09)、交互机制(13)由主线程落地；角色效果(11)、黑市效果(12)、UI 组件(14)、web 联调(15)由并行 subAgent 完成。
- 简易模式 2 人局端到端可玩：server 内存房间 + resolvePrompt 协议(docs/protocol.md) + prompt 超时 autoResolve + 掉线托管；web GameClient/Lobby/Table 最小接线。
- 测试：engine 88 + card-data 15 + server e2e 4 = 107 全绿。
- 已知遗留（M2 时点）：resolveTiming 未按 roleId 展开持有者(角色效果 run 内 applyToHolders 兜底)；花色/牌型声明类需芯片视图、效果占位、SQLite 局摘要——均已由票据 18-20 消化，见上段；事件牌/命运牌 handler 待 M3。
- 工作流验证有效：4 个并行 subAgent 各加载 wayfinder，claim→实现→resolve→commit，无文件冲突(共享基础设施由主线程先行提交)。

## 本地启动方式（2026-08-30 验证通过）
- 后端(WS 8080)：从仓库根跑 `CONFIG_DIR="$(pwd)/config" npm run dev -w @crimson/server`——**必须显式传 CONFIG_DIR**，否则 server 按 cwd/config 找卡池会抛错（设计如此，不静默降级）。
- 前端(Vite 5173)：`npm run dev -w @crimson/web`，WS 直连 `ws://localhost:8080`（VITE_WS_URL 可覆盖；vite 的 /ws 代理存在但客户端默认不用）。
- 体验需 2-4 人：开两个浏览器窗口（普通 + 隐身）分别建房/入房，房主点开始。
- 停止：`pkill -f "tsx watch src/index.ts"`、`pkill -f vite`。
