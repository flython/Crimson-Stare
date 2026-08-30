/**
 * 角色牌效果注册（票据 11，M2.2）。
 *
 * 三机制：
 * - roleSetup：游戏开始时应用一次（createGame 设置 characterId 后调用；key = effectId 前缀 "role:XX"）
 * - EffectDef 阶段效果：以 (phase, timing) 注册，resolveTiming 触发；run 内按 roleId 匹配持有者展开
 *   （applyToHolders：兼容 resolveTiming 未按 roleId 展开的现状——当前全量入队 + playerId 固定
 *   players[0]，run 自行遍历持有者各结算一次；未来 effects.ts 按 roleId 展开后 direct 分支直接复用
 *   ctx.playerId，不会重复结算）
 * - 动作钩子：swapZero 等内嵌在 reducer 动作中的触发点（registerActionHook）
 *
 * 规则来源：docs/血色牌局_规则书.md + config/cards/roles.json 的 effectText（冲突时卡面文本优先，金科玉律 14）。
 * 实现约束：只组合 primitives/interactive 原语，同模式卡用工厂复用；
 *   交互/机制缺失的效果注册 placeholderEffect 占位（无效果 + log「效果未实现」），并注明 TODO。
 *
 * 触发点映射说明：whiteboard 仅在进入 draw/duel/settle/reshape 跑 before、离开各阶段跑 after，
 *   roles.json triggers 中的 during 统一落到实际触发点（before 或 after）。
 *
 * 已知 whiteboard 时序缺陷（不改 whiteboard.ts 的规避）：
 *   createGame 中 roleSetup 在「初始血筹赋值」之前执行，role:02 开局 +2 血筹会被覆盖，
 *   故该效果改挂 draw 阶段 before（turn===1 时触发），该时机在初始血筹赋值之后。
 */
import type { EffectBody } from "./primitives.js";
import { deleteFromDiscard, findCardInZones, getPlayer, gainChips, placeholderEffect } from "./primitives.js";
import type { EffectContext } from "../core/effects.js";
import { registerActionHook, registerEffect } from "../core/effects.js";
import type { GameState, PlayerState } from "../core/state.js";
import type { ChipView } from "../hand-evaluator.js";

/** 按角色持有者展开：对每个 characterId === roleId 的玩家应用 body（各结算一次） */
function applyToHolders(state: GameState, ctx: EffectContext, roleId: string, body: EffectBody): void {
  if (ctx.playerId) {
    const direct = state.players.find((p) => p.id === ctx.playerId);
    if (direct?.characterId === roleId) {
      body(state, ctx); // 已由 resolveTiming 按持有者展开（未来 effects.ts），直接应用一次
      return;
    }
  }
  for (const p of state.players) {
    if (p.characterId === roleId) body(state, { ...ctx, playerId: p.id });
  }
}

/** 占位效果：仅在有持有者时写降级日志（白板局不产生噪音） */
function placeholderFor(roleId: string): EffectBody {
  return (state, ctx) => applyToHolders(state, ctx, roleId, placeholderEffect);
}

/**
 * 角色判定视图（票据 20）：把角色牌型映射交给 hand-evaluator 求解器取最优，无需玩家交互。
 * - role:05 特型演员：2 可视为 5
 * - role:07 杂技演员：6 可视为 9、9 可视为 6
 * - role:17 枪手：4 可视为小丑（候选集含原值，故"全部纳入"不会让结果变差）
 * 技能失效时返回 undefined（不注入任何映射）。
 */
export function roleChipView(p: PlayerState): ChipView | undefined {
  if (p.skillDisabled) return undefined;
  const rankOptions: Record<string, number[]> = {};
  const asJoker: string[] = [];
  for (const c of p.zones.play) {
    if (c.isJoker) continue; // JOKER 本就由求解器赋值
    if (p.characterId === "role:05" && c.rank === 2) rankOptions[c.id] = [2, 5];
    else if (p.characterId === "role:07" && c.rank === 6) rankOptions[c.id] = [6, 9];
    else if (p.characterId === "role:07" && c.rank === 9) rankOptions[c.id] = [9, 6];
    else if (p.characterId === "role:17" && c.rank === 4) asJoker.push(c.id);
  }
  const view: ChipView = {};
  if (Object.keys(rankOptions).length > 0) view.rankOptions = rankOptions;
  if (asJoker.length > 0) view.asJoker = asJoker;
  return Object.keys(view).length > 0 ? view : undefined;
}

/** 设置玩家 bonus 字段（roleSetup 用；字段由 whiteboard 对应接入点消费） */
function setBonus(field: "duelPointsBonus" | "handLimitBonus" | "swapBonus", n: number): EffectBody {
  return (state, ctx) => {
    const p = getPlayer(state, ctx);
    p[field] = n;
  };
}

/** 游戏开始时应用一次（createGame 设置 characterId 后调用；key = effectId 前缀 "role:XX"） */
export const roleSetup: Record<string, EffectBody> = {
  // —— 简易角色（常驻/初始效果） ——
  "role:01": setBonus("duelPointsBonus", 20), // 赌场荷官【结算阶段】牌型总点数+20（resolveDuel 已消费）
  // role:02 银行职员 开局 +2 血筹：因 whiteboard 时序（roleSetup 在初始血筹赋值前执行，会被覆盖）
  //   改挂 draw-before EffectDef（见 registerRoleEffects），此处不注册。
  "role:03": setBonus("handLimitBonus", 1), // 魔术师 手牌上限+1（drawToHandLimit 已消费）
  "role:04": setBonus("swapBonus", 1), // 酒保 换牌次数+1（enterPhase swap 已消费；归零得筹走 swapZero 钩子）
  // —— 需要选牌交互 / 依赖开局后牌堆的效果，setup 时机（发牌前）无法执行，占位降级 ——
  "role:05": placeholderEffect, // TODO: 特型演员 开局删除 2 张 2（需选牌交互，且 setup 时牌堆未构建）
  "role:21": placeholderEffect, // TODO: 黑客 初始构筑改为从全牌库挑 8 张删除（需选牌交互，属初始构筑阶段而非 setup）
};

/** 注册角色阶段效果与动作钩子（模块加载时执行一次） */
export function registerRoleEffects(): void {
  // —— 已实现：阶段效果 ——
  // role:02 银行职员 游戏开始额外 2 血筹（draw before 在初始血筹赋值后触发；turn===1 限定仅开局一次）
  registerEffect({
    id: "role:02:start",
    source: "character",
    roleId: "role:02",
    phase: "draw",
    timing: "before",
    run: (state, ctx) => {
      if (state.turn !== 1) return;
      applyToHolders(state, ctx, "role:02", gainChips(2));
    },
  });
  // role:02 银行职员【重整阶段】获得 2 血筹（whiteboard 进入 reshape 时跑 before hooks）
  registerEffect({
    id: "role:02:reshape",
    source: "character",
    roleId: "role:02",
    phase: "reshape",
    timing: "before",
    run: (state, ctx) => applyToHolders(state, ctx, "role:02", gainChips(2)),
  });
  // role:06 矿工【对决阶段】若打出的牌均为黑色则获得 3 血筹（resolveDuel 前 play 区仍有牌）
  registerEffect({
    id: "role:06:duel",
    source: "character",
    roleId: "role:06",
    phase: "duel",
    timing: "before",
    run: minerDuel,
  });
  // role:09 股民【购买阶段】结束时若剩余 0 血筹则获得 3 血筹（endPurchasePhase 跑 after hooks）
  registerEffect({
    id: "role:09:purchase",
    source: "character",
    roleId: "role:09",
    phase: "purchase",
    timing: "after",
    run: shareholderPurchase,
  });
  // role:15 特级大厨【对决阶段】每打出 1 张 3 获得 1 血筹（部分实现；换牌弃 3 / 删 3 无钩子，见占位）
  registerEffect({
    id: "role:15:duel",
    source: "character",
    roleId: "role:15",
    phase: "duel",
    timing: "before",
    run: chefDuel,
  });
  // role:17 枪手【结算阶段】结束删除本回合"视为小丑的 4"（判定视图见 roleChipView）
  registerEffect({
    id: "role:17:settle",
    source: "character",
    roleId: "role:17",
    phase: "settle",
    timing: "after",
    run: gunnerSettleDelete,
  });
  // role:20 武士【结算阶段】额外获得本回合获得的【车票】数量的血筹
  registerEffect({
    id: "role:20:settle",
    source: "character",
    roleId: "role:20",
    phase: "settle",
    timing: "after",
    run: samuraiSettle,
  });

  // —— 已实现：动作钩子 ——
  // role:04 酒保：剩余换牌次数归 0 时获得 1 血筹（whiteboard swap 动作归 0 时触发）
  registerActionHook("role:04", "swapZero", gainChips(1));
  // role:13 洗衣房店主：重洗牌库得 1 血筹；不重洗额外得 2 血筹（whiteboard reshape/抽牌重洗点触发）
  registerActionHook("role:13", "reshuffle", gainChips(1));
  registerActionHook("role:13", "noReshuffle", gainChips(2));

  // —— 交互/机制缺失：占位注册（不阻塞；真身待交互机制或 reducer 钩子落地） ——
  // role:05/07/17 的牌型映射已由 roleChipView 在判定层真身化（无需阶段效果注册）；
  // role:13 重洗/不重洗已由动作钩子真身化；role:20 武士已真身化。
  registerEffect({ id: "role:08:purchase", source: "character", roleId: "role:08", phase: "purchase", timing: "after", run: placeholderFor("role:08") }); // TODO: 【购买阶段】前抢劫：放弃/抵抗 + 轮流掷骰（复杂交互留 M3）
  registerEffect({ id: "role:10:swap", source: "character", roleId: "role:10", phase: "swap", timing: "after", run: placeholderFor("role:10") }); // TODO: 【换牌阶段】先抽再弃、每次最多 2 抽 2 弃（需改 swap 行为）
  registerEffect({ id: "role:11:purchase", source: "character", roleId: "role:11", phase: "purchase", timing: "after", run: placeholderFor("role:11") }); // TODO: 【购买阶段】首次购买半价（需拦截 purchase 价格计算）
  registerEffect({ id: "role:12:swap", source: "character", roleId: "role:12", phase: "swap", timing: "after", run: placeholderFor("role:12") }); // TODO: 【换牌阶段】花 1 筹抽 1 张（无次数限制）
  registerEffect({ id: "role:12:settle", source: "character", roleId: "role:12", phase: "settle", timing: "after", run: placeholderFor("role:12") }); // TODO: 【结算阶段】结束花 1 筹删 1 张本回合打出的牌（最多 3，需选牌交互）
  registerEffect({ id: "role:14:swap", source: "character", roleId: "role:14", phase: "swap", timing: "after", run: placeholderFor("role:14") }); // TODO: 【换牌阶段】可选任意数量换牌；一次弃 4+ 得 1 筹（需改 swap 行为）
  registerEffect({ id: "role:15:swap", source: "character", roleId: "role:15", phase: "swap", timing: "after", run: placeholderFor("role:15") }); // TODO: 【换牌阶段】弃置 1 张 3 得 1 筹（需 swap 弃牌感知钩子）
  registerEffect({ id: "role:16:duel", source: "character", roleId: "role:16", phase: "duel", timing: "before", run: placeholderFor("role:16") }); // TODO: 【对决阶段】前弃出牌区全部牌 + 删牌一次（需主动发动选择 + 选牌交互）
  registerEffect({ id: "role:18:reshape", source: "character", roleId: "role:18", phase: "reshape", timing: "after", run: placeholderFor("role:18") }); // TODO: 【重整阶段】结束从全牌库删 1 张（需选牌交互）
  registerEffect({ id: "role:19:duel", source: "character", roleId: "role:19", phase: "duel", timing: "before", run: placeholderFor("role:19") }); // TODO: 【对决阶段】前猜本回合特权证玩家（需两段式中间状态，PlayerState 无临时字段）
  registerEffect({ id: "role:19:settle", source: "character", roleId: "role:19", phase: "settle", timing: "after", run: placeholderFor("role:19") }); // TODO: 【结算阶段】猜对得（人数+2）筹（依赖 role:19:duel 的猜测记录）
  registerEffect({ id: "role:21:delete", source: "character", roleId: "role:21", phase: "delete", timing: "after", run: placeholderFor("role:21") }); // TODO: 【删牌阶段】额外免费删除 1 张（需 delete 免费额度钩子）
}

/** role:06 矿工：对决阶段若打出的牌均为黑色则获得 3 血筹（JOKER 无花色，不算黑色） */
const minerDuel: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:06", (s, c) => {
    const p = getPlayer(s, c);
    const played = p.zones.play;
    const allBlack = played.length > 0 && played.every((card) => !card.isJoker && (card.suit === "S" || card.suit === "C"));
    if (allBlack) gainChips(3)(s, c);
  });
};

/** role:09 股民：购买阶段结束时若剩余 0 血筹则获得 3 血筹 */
const shareholderPurchase: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:09", (s, c) => {
    const p = getPlayer(s, c);
    if (p.chips === 0) gainChips(3)(s, c);
  });
};

/**
 * role:17 枪手【结算阶段】结束：删除本回合"视为小丑的 4"。
 * 判据：duelResult 中该牌 wasJoker（被纳入 JOKER 求解）且求解后点数不再是 4，
 * 同时牌实例本身的点数仍为 4（排除真 JOKER）。
 */
const gunnerSettleDelete: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:17", (s, c) => {
    const p = getPlayer(s, c);
    const entry = s.duelResult?.find((r) => r.playerId === p.id);
    if (!entry) return;
    const ids = entry.cards
      .filter((rc) => rc.wasJoker && rc.rank !== 4 && findCardInZones(p, rc.id)?.rank === 4)
      .map((rc) => rc.id);
    for (const id of ids) deleteFromDiscard(id)(s, c);
  });
};

/** role:20 武士【结算阶段】：额外获得本回合获得的【车票】数量的血筹 */
const samuraiSettle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:20", (s, c) => {
    const p = getPlayer(s, c);
    const n = p.ticketsGainedThisTurn ?? 0;
    if (n > 0) gainChips(n)(s, c);
  });
};

/** role:15 特级大厨（部分）：对决阶段每打出 1 张 3 获得 1 血筹 */
const chefDuel: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:15", (s, c) => {
    const p = getPlayer(s, c);
    const n = p.zones.play.filter((card) => card.rank === 3).length;
    if (n > 0) gainChips(n)(s, c);
  });
};

registerRoleEffects();
