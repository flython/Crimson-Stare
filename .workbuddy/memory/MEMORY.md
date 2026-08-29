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
