/**
 * 黑市牌效果注册（票据 12，M2.3）。
 *
 * 占位骨架（由 subAgent 填充）：
 * - 每个黑市牌一个 EffectDef，id = "market:<defId>"，source = "blackMarket"；
 *   购买结算走 handlePurchase（whiteboard 按注册表分发：秘密交易 run 立即结算，强化芯片 run 挂起选牌 + resolve 插入并应用）。
 * - 阶段时机效果（对决/结算等）以 (phase, timing) 注册，由 resolveTiming 触发。
 * - 备用道具不需注册 run（handlePurchase 直接存 items），使用时（M2.4 后）再结算。
 *
 * 规则来源：docs/血色牌局_规则书.md + config/cards/market.json 的 effectText。
 * 实现约束：只组合 primitives/interactive 原语，同模式卡用工厂复用；未实现的效果不注册（由占位 log 降级）。
 */
export function registerMarketEffects(): void {}

registerMarketEffects();
