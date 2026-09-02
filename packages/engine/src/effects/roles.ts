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
import {
  clearPlayZone,
  deleteFromDiscard,
  findCardInZones,
  getPlayer,
  gainChips,
  logText,
  placeholderEffect,
  registerDeleteHook,
  afterCardsDeleted,
} from "./primitives.js";
import { promptChooseCard, promptChooseOption, promptChoosePlayer } from "./interactive.js";
import { shuffle } from "../core/rng.js";
import type { EffectContext } from "../core/effects.js";
import { registerActionHook, registerEffect } from "../core/effects.js";
import type { GameState, PlayerState, SetupDeleteEntry } from "../core/state.js";
import type { Card } from "../cards.js";
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
    // role:17 枪手 / role:65 魔法少女 / role:77 快递员：指定 rank 视为 JOKER
    else if (c.rank === 4 && (p.characterId === "role:17" || p.characterId === "role:65")) asJoker.push(c.id);
    else if (c.rank === 2 && p.characterId === "role:77") asJoker.push(c.id);
  }
  const view: ChipView = {};
  if (Object.keys(rankOptions).length > 0) view.rankOptions = rankOptions;
  if (asJoker.length > 0) view.asJoker = asJoker;
  return Object.keys(view).length > 0 ? view : undefined;
}

/**
 * 角色常驻能力复位（票据 20）：每回合开始由 whiteboard resetTurnState 调用。
 * 常驻能力不随回合标记清理而消失（如黑客每回合都可免费多删 1 张）。
 */
export function roleTurnSetup(p: PlayerState): void {
  const off = p.skillDisabled === true; // 技能失效时常驻能力一并失效
  // freeDeleteExtra: 黑客(21)、车棋(69)、高中生(16) 执行后、烂泥(66) 执行后
  p.freeDeleteExtra =
    (!off && (p.characterId === "role:21" || p.characterId === "role:69")) ? 1
    : (!off && (p.characterId === "role:16" || p.characterId === "role:66")) ? (p.freeDeleteExtra ?? 0)
    : 0;
  // swapPolicy: 塔罗师(10)/欺诈师(63) 先抽后弃；偶像(14) 任意数量
  p.swapPolicy = off
    ? undefined
    : p.characterId === "role:10" || p.characterId === "role:63"
      ? "drawFirst"
      : p.characterId === "role:14"
        ? "anyCount"
        : undefined;
  // 捣蛋鬼(22)：必须跳过重整阶段，角色标记由 createGame 处理
  // 删牌阶段跳过：女仆(25) 必须跳过删牌阶段
  // paidDeleteOnly: 飞车党(26)、双生子兄(28) 只可付筹删牌
  if (!off && p.characterId === "role:25") {
    p.skipDeletePhase = true;
  }
  if (!off && (p.characterId === "role:26" || p.characterId === "role:28")) {
    p.paidDeleteOnly = true;
  }
  // 无面人(38)：每回合抽牌阶段前需选角色技能，此处仅重置临时状态
  if (!off && p.characterId === "role:38") {
    p.roleSkillExpiresAt = "draw"; // 抽牌阶段开始时过期
  }
}

/**
 * 购买价格修正（票据 20）：吉祥物每回合首次购买半价。
 * 卡面示例「3 血筹的牌以 1 血筹购入」= 向下取整（与"向上取整"四字冲突，按示例实现，见票据 20 Answer）。
 * 吉祥物口径（票据 35 固化）：卡面「价格优惠一半（向上取整）。例 3→1」——
 * 「优惠一半」的优惠额向上取整 = 价格向下取整，与下方 Math.floor(price/2) 一致，卡面文字与示例无矛盾。
 */
export function characterPurchasePrice(p: PlayerState, price: number): number {
  if (p.skillDisabled) return price;
  // 吉祥物(11)/女皇(68)：每回合首次购买半价（向上取整=价格向下取整）
  if ((p.characterId === "role:11" || p.characterId === "role:68") && !p.purchasedThisTurn) {
    return Math.floor(price / 2);
  }
  // 魏王(45)/走私客(31)：购买强化芯片/指定黑市牌 价格-2
  // 魏王仅对强化芯片有效；走私客由指定钩子覆盖，此处不加
  if (p.characterId === "role:45" && !p.purchasedThisTurn) {
    // 价格-2，但不低于0
    return Math.max(0, price - 2);
  }
  return price;
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
  "role:22": (s, c) => {
    // 捣蛋鬼：技能无法被无效，必须跳过重整阶段
    const p = getPlayer(s, c);
    p.skillImmune = true;
    p.mustSkipReshape = true;
  },
  "role:29": (s, c) => {
    // 贵族：开局获得12血筹（gameStart 时在初始血筹赋值后执行，此处直接加）
    const p = getPlayer(s, c);
    p.chips += 12;
  },
  // —— 以下需要开局后牌堆，需 createGame/whiteboard 处理的，roleSetup 仅设标记 ——
  "role:05": (s, c) => {
    // 特型演员：开局删除手牌中的 2（role:05 chipView 已处理"2 可视为 5"的判定映射）
    const p = getPlayer(s, c);
    const entry: SetupDeleteEntry = { playerId: p.id, count: 2, rank: 2 };
    if (!s.setupDeleteQueue) s.setupDeleteQueue = [];
    s.setupDeleteQueue.push(entry);
  },
  "role:21": placeholderEffect, // TODO: 黑客 初始构筑删除（等飞飞确认："初始构筑时从全牌库/抽牌堆/手牌中选8张删除"？）
  // role:26 飞车党：开局删 J/Q/K/A + 跳过初始构筑 → createGame 处理
  // role:27/28 双生子：找双生镜片 → createGame 处理
  // role:38 无面人：构建角色牌堆 → createGame 处理
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

  // role:15 特级大厨「任意时候，每当你删除 1 张 3，获得 4 血筹」（组队模式已排除，只计本人）。
  // 走删除钩子而非阶段效果：删牌阶段 Action 与效果原语 deleteCards 两条路径共用 afterCardsDeleted 入口。
  registerDeleteHook((state, ctx, cards) => {
    const p = state.players.find((x) => x.id === ctx.playerId);
    if (!p || p.characterId !== "role:15" || p.skillDisabled) return;
    const threes = cards.filter((c) => c.rank === 3).length;
    if (threes > 0) gainChips(threes * 4)(state, ctx);
  });

  // —— 交互/机制缺失：占位注册（不阻塞；真身待交互机制或 reducer 钩子落地） ——
  // 已真身化但不在阶段效果层的：role:05/07/17 牌型映射（roleChipView 判定层）、
  // role:13 重洗/不重洗（动作钩子）、role:10 先抽后弃 / role:12 付费抽牌（reducer 新 Action）、
  // role:11 半价 / role:21 免费额度 / role:14 任意数量换牌 / role:15 弃 3 得筹（reducer 分支内角色分支）。
  // role:19 职业赌徒【对决阶段】前猜测本回合特权证玩家（可猜自己）；猜测记录在 declarations，结算比对。
  // 交互挂在 duel/before：whiteboard 的阶段挂起机制保证猜测完成后才进行判定。
  registerEffect({
    id: "role:19:duel",
    source: "character",
    roleId: "role:19",
    phase: "duel",
    timing: "before",
    run: gamblerDuel,
    resolve: gamblerDuelResolve,
  });
  // role:19 职业赌徒【结算阶段】猜对则获得（人数+2）血筹
  registerEffect({
    id: "role:19:settle",
    source: "character",
    roleId: "role:19",
    phase: "settle",
    timing: "after",
    run: gamblerSettle,
  });
  // role:12 炸鸡店老板【结算阶段】结束：花 1 血筹删 1 张本回合打出的牌（最多 3 张）
  registerEffect({
    id: "role:12:settle",
    source: "character",
    roleId: "role:12",
    phase: "settle",
    timing: "after",
    run: friedChickenSettle,
    resolve: friedChickenSettleResolve,
  });

  // role:16 高中生【对决阶段】前：弃置出牌区全部牌（牌型视为高牌 0 点）+ 2 血筹 + 执行一次删牌。
  // 两段式交互：chooseOption（是否发动）→ resolve 内再挂 chooseCard（选 1 张删）。
  registerEffect({
    id: "role:16:duel",
    source: "character",
    roleId: "role:16",
    phase: "duel",
    timing: "before",
    run: highSchoolDuel,
    resolve: highSchoolDuelResolve,
  });
  // role:18 清洁工【重整阶段】结束：从全牌库（抽牌堆+弃牌区）删 1 张；删到抽牌堆的牌则重洗抽牌堆
  registerEffect({
    id: "role:18:reshape",
    source: "character",
    roleId: "role:18",
    phase: "reshape",
    timing: "after",
    run: cleanerReshape,
    resolve: cleanerReshapeResolve,
  });

  // ── role:22-79 新角色效果注册 ──────────────────────────────────────────────

  // role:08 海盗【购买阶段前】：抢劫（放弃/抵抗+轮流掷骰），占位待 M3 交互
  registerEffect({ id: "role:08:purchase", source: "character", roleId: "role:08", phase: "purchase", timing: "after", run: placeholderFor("role:08") });

  // role:24 咒术师【换牌阶段】：可将手中的5置于角色牌下（游戏外），得1筹，抽1张
  registerEffect({ id: "role:24:swap", source: "character", roleId: "role:24", phase: "swap", timing: "during", run: role24Swap, resolve: role24SwapResolve });
  // role:24 咒术师【换牌阶段结束】：可将角色牌下的5收回手牌
  registerEffect({ id: "role:24:swapEnd", source: "character", roleId: "role:24", phase: "swap", timing: "after", run: role24SwapEnd, resolve: role24SwapEndResolve });

  // role:25 女仆【对决阶段】：♥=♠（心形视为黑桃）；删牌阶段跳过已在 roleTurnSetup 处理
  registerEffect({ id: "role:25:duel", source: "character", roleId: "role:25", phase: "duel", timing: "before", run: role25Duel });

  // role:29 贵族【游戏开始】：获得12血筹（已在 roleSetup 直接加）

  // role:30 主播【换牌阶段】：一次性弃置至少2张点数相同的牌，得3筹（每回合1次）
  registerEffect({ id: "role:30:swap", source: "character", roleId: "role:30", phase: "swap", timing: "after", run: role30Swap });

  // role:31 走私客【购买阶段前】：指定黑市区1张牌本回合价格-2；其他玩家购买需先交2筹
  registerEffect({ id: "role:31:purchase", source: "character", roleId: "role:31", phase: "purchase", timing: "before", run: role31Purchase, resolve: role31PurchaseResolve });

  // role:32 画家【对决阶段】：出牌区3种花色得2筹，4种花色再得1筹
  registerEffect({ id: "role:32:duel", source: "character", roleId: "role:32", phase: "duel", timing: "before", run: role32Duel });

  // role:33 赌神【换牌阶段结束】：查看所有玩家手牌，额外换牌1次或得1筹
  registerEffect({ id: "role:33:swapEnd", source: "character", roleId: "role:33", phase: "swap", timing: "after", run: role33SwapEnd, resolve: role33SwapEndResolve });

  // role:34 质检员【重整阶段】：不重洗得2筹+将1张弃牌放抽牌堆顶；重洗得1筹（动作钩子已在13号）
  // （质检员不重洗的额外效果：放1张弃牌到抽牌堆顶）
  registerEffect({ id: "role:34:reshape", source: "character", roleId: "role:34", phase: "reshape", timing: "after", run: role34Reshape, resolve: role34ReshapeResolve });

  // role:35 将军【换牌阶段结束】：选玩家，其随机弃1摸1，或你额外换牌1次
  registerEffect({ id: "role:35:swapEnd", source: "character", roleId: "role:35", phase: "swap", timing: "after", run: role35SwapEnd, resolve: role35SwapEndResolve });

  // role:36 票贩子【结算阶段】：不持特权证可向特权证玩家付3筹强制购买其1车票
  registerEffect({ id: "role:36:settle", source: "character", roleId: "role:36", phase: "settle", timing: "after", run: role36Settle, resolve: role36SettleResolve });

  // role:37 私家侦探【抽牌阶段前】：将弃牌区1张放抽牌堆顶/至多3张放抽牌堆底；未如此做得1筹
  registerEffect({ id: "role:37:draw", source: "character", roleId: "role:37", phase: "draw", timing: "before", run: role37Draw, resolve: role37DrawResolve });

  // role:38 无面人【抽牌阶段前】：从角色牌堆抽2选1获得其技能（临时）；可永久转化
  registerEffect({ id: "role:38:draw", source: "character", roleId: "role:38", phase: "draw", timing: "before", run: role38Draw, resolve: role38DrawResolve });

  // role:39 瞎掰王【对决阶段前】：宣告牌面，从有☠玩家开始顺时针质疑
  registerEffect({ id: "role:39:duel", source: "character", roleId: "role:39", phase: "duel", timing: "before", run: role39Duel, resolve: role39DuelResolve });

  // role:40 白蔷薇【换牌阶段】：第一位宣告换牌结束得3筹
  registerEffect({ id: "role:40:swapEnd", source: "character", roleId: "role:40", phase: "swap", timing: "after", run: role40SwapEnd });

  // role:41 神作章鱼【换牌阶段结束】：弃牌区洗混，随机抽至多2张加入手牌
  registerEffect({ id: "role:41:swapEnd", source: "character", roleId: "role:41", phase: "swap", timing: "after", run: role41SwapEnd });

  // role:42 我的名字？【游戏开始】：自定义牌型名称
  registerEffect({ id: "role:42:start", source: "character", roleId: "role:42", phase: "draw", timing: "before", run: role42Start, resolve: role42StartResolve });
  // role:42 对决阶段：打出自定义牌型得2筹（由 whiteboard 结算阶段统一处理，这里仅注册）
  registerEffect({ id: "role:42:duel", source: "character", roleId: "role:42", phase: "duel", timing: "before", run: role42Duel });

  // role:43 瞎掰帝【购买阶段前】：查看黑市顶2张选1张暗置，轮流叫价竞拍
  registerEffect({ id: "role:43:purchase", source: "character", roleId: "role:43", phase: "purchase", timing: "before", run: role43Purchase, resolve: role43PurchaseResolve });

  // role:44 窥天师【购买阶段前】：天意价格-2（普通抽牌堆顶牌在resolve中处理）
  registerEffect({ id: "role:44:purchase", source: "character", roleId: "role:44", phase: "purchase", timing: "before", run: role44Purchase, resolve: role44PurchaseResolve });

  // role:45 魏王【购买阶段结束】：若购买过黑市牌得2筹
  registerEffect({ id: "role:45:purchaseEnd", source: "character", roleId: "role:45", phase: "purchase", timing: "after", run: role45PurchaseEnd });

  // role:46 皇叔【结算阶段】：检测是否满足"车票达目标一半+54张全删"直接胜利
  registerEffect({ id: "role:46:settle", source: "character", roleId: "role:46", phase: "settle", timing: "after", run: role46Settle });

  // role:47 江东之主：始终持有特权证（创建游戏时强制设置）；持有时每回合得2筹（此处加在结算后）
  registerEffect({ id: "role:47:settle", source: "character", roleId: "role:47", phase: "settle", timing: "after", run: role47Settle });

  // role:48 猪神病人【任意时刻】：拍桌子最晚者交血筹
  registerEffect({ id: "role:48:action", source: "character", roleId: "role:48", phase: "purchase", timing: "before", run: role48Action, resolve: role48ActionResolve });

  // role:49 地下城主【换牌阶段前】：掷骰，≥3调整换牌次数，<3得血筹
  registerEffect({ id: "role:49:swap", source: "character", roleId: "role:49", phase: "swap", timing: "before", run: role49Swap, resolve: role49SwapResolve });

  // role:50 霸道总裁【换牌阶段结束】：依次选玩家交给血筹；对方选择收或拒绝
  registerEffect({ id: "role:50:swapEnd", source: "character", roleId: "role:50", phase: "swap", timing: "after", run: role50SwapEnd, resolve: role50SwapEndResolve });

  // role:51 无业游民【换牌阶段结束】：从对手抽牌区抽共2张
  registerEffect({ id: "role:51:swapEnd", source: "character", roleId: "role:51", phase: "swap", timing: "after", run: role51SwapEnd, resolve: role51SwapEndResolve });
  // role:51 无业游民【对决阶段】：出牌区每有对手1张牌该对手给1筹
  registerEffect({ id: "role:51:duel", source: "character", roleId: "role:51", phase: "duel", timing: "after", run: role51Duel });
  // role:51 无业游民【结算阶段结束】：将对手的牌放回对手弃牌区
  registerEffect({ id: "role:51:settle", source: "character", roleId: "role:51", phase: "settle", timing: "after", run: role51Settle });

  // role:52 编剧【对决阶段】：总点数恰好50得5筹；否则跳过购买+删牌阶段
  registerEffect({ id: "role:52:duel", source: "character", roleId: "role:52", phase: "duel", timing: "after", run: role52Duel });

  // role:53 双重人格公主【使用技能后】：切换人格（弃牌堆翻面）
  // （切换在具体技能执行后调用，不走阶段注册）
  registerEffect({ id: "role:53:duel", source: "character", roleId: "role:53", phase: "duel", timing: "before", run: role53Duel });
  registerEffect({ id: "role:53:settle", source: "character", roleId: "role:53", phase: "settle", timing: "after", run: role53Settle });

  // role:54 入殓师【换牌阶段】：特殊换牌（至多3张置于角色牌上，从弃牌区随机抽等量）
  registerEffect({ id: "role:54:swap", source: "character", roleId: "role:54", phase: "swap", timing: "during", run: role54Swap, resolve: role54SwapResolve });
  // role:54 入殓师【换牌阶段结束】：将角色牌上的牌置入弃牌区；未使用特殊换牌得2筹
  registerEffect({ id: "role:54:swapEnd", source: "character", roleId: "role:54", phase: "swap", timing: "after", run: role54SwapEnd, resolve: role54SwapEndResolve });

  // role:55 赌狗【删牌阶段】：选玩家，该玩家掷骰，删其抽牌堆顶(X-1)张
  registerEffect({ id: "role:55:delete", source: "character", roleId: "role:55", phase: "delete", timing: "before", run: role55Delete, resolve: role55DeleteResolve });

  // role:56 特工【出牌阶段结束】：指定玩家询问是否交换出牌区；拒绝给2筹；结算阶段归还
  registerEffect({ id: "role:56:play", source: "character", roleId: "role:56", phase: "play", timing: "after", run: role56Play, resolve: role56PlayResolve });
  registerEffect({ id: "role:56:settle", source: "character", roleId: "role:56", phase: "settle", timing: "after", run: role56Settle });

  // role:57 咖啡师【购买阶段结束】：第一次购买原价格≥3的黑市牌时，免费获得黑市堆顶1张
  registerEffect({ id: "role:57:purchaseEnd", source: "character", roleId: "role:57", phase: "purchase", timing: "after", run: role57PurchaseEnd });

  // role:58 魅魔【结算阶段】：持特权证抢♂3筹；不持抢♀1筹
  registerEffect({ id: "role:58:settle", source: "character", roleId: "role:58", phase: "settle", timing: "after", run: role58Settle, resolve: role58SettleResolve });

  // role:59 炸弹客【换牌阶段前】：申报数字X获得X筹
  registerEffect({ id: "role:59:swap", source: "character", roleId: "role:59", phase: "swap", timing: "before", run: role59Swap, resolve: role59SwapResolve });
  // role:59 炸弹客【结算阶段结束】：其他玩家随机删X张，自己删X+1张
  registerEffect({ id: "role:59:settle", source: "character", roleId: "role:59", phase: "settle", timing: "after", run: role59Settle });

  // role:60 资本家【每个阶段结束后】：1车票换4血筹，或8血筹换1车票
  registerEffect({ id: "role:60:phaseEnd", source: "character", roleId: "role:60", phase: "draw", timing: "after", run: role60PhaseEnd });
  registerEffect({ id: "role:60:swapEnd", source: "character", roleId: "role:60", phase: "swap", timing: "after", run: role60PhaseEnd });
  registerEffect({ id: "role:60:playEnd", source: "character", roleId: "role:60", phase: "play", timing: "after", run: role60PhaseEnd });
  registerEffect({ id: "role:60:duelEnd", source: "character", roleId: "role:60", phase: "duel", timing: "after", run: role60PhaseEnd });
  registerEffect({ id: "role:60:settleEnd", source: "character", roleId: "role:60", phase: "settle", timing: "after", run: role60PhaseEnd });
  registerEffect({ id: "role:60:purchaseEnd", source: "character", roleId: "role:60", phase: "purchase", timing: "after", run: role60PhaseEnd });
  registerEffect({ id: "role:60:deleteEnd", source: "character", roleId: "role:60", phase: "delete", timing: "after", run: role60PhaseEnd });
  registerEffect({ id: "role:60:reshapeEnd", source: "character", roleId: "role:60", phase: "reshape", timing: "after", run: role60PhaseEnd });

  // role:61 风水师【购买阶段结束】：剩余0血筹获得3血筹
  registerEffect({ id: "role:61:purchaseEnd", source: "character", roleId: "role:61", phase: "purchase", timing: "after", run: role61PurchaseEnd });

  // role:62 退堂鼓选手【结算阶段结束】：花1筹删1张本回合打出的牌（最多3张）
  registerEffect({ id: "role:62:settle", source: "character", roleId: "role:62", phase: "settle", timing: "after", run: role62Settle, resolve: role62SettleResolve });

  // role:63 欺诈师（同塔罗师10：先抽后弃）—— swapPolicy 已在 roleTurnSetup 处理

  // role:64 格斗家【购买阶段前】：抢劫（放弃交2筹/抵抗掷骰抢至多4筹）
  registerEffect({ id: "role:64:purchase", source: "character", roleId: "role:64", phase: "purchase", timing: "before", run: role64Purchase, resolve: role64PurchaseResolve });

  // role:65 魔法少女【结算阶段结束】：删除视为Joker的4
  registerEffect({ id: "role:65:settle", source: "character", roleId: "role:65", phase: "settle", timing: "after", run: role65SettleDelete });

  // role:66 烂泥【对决阶段前】：弃置出牌区全部牌，得2筹，可删1张
  registerEffect({ id: "role:66:duel", source: "character", roleId: "role:66", phase: "duel", timing: "before", run: role66Duel, resolve: role66DuelResolve });

  // role:67 炼金术士（同特级大厨15：弃3得1/打出3得1/删3得4）—— 已复用 chefDuel + registerDeleteHook(15)

  // ── 重复型角色：复用已有函数，只需注册 roleId ─────────────────────────────
  // role:68 女皇（同吉祥物11）：半价 → characterPurchasePrice 已处理
  // role:69 车棋（同黑客21）：freeDeleteExtra=1 → roleTurnSetup 已处理
  // role:70 技师（同杂技演员07）：rank映射 → roleChipView 已处理
  // role:71 桌游管理员（同赌场荷官01）：duelPointsBonus=20（通过 whiteboard resolveDuel 的 duelPointsBonus 消费）
  // role:72 硬银总裁（同武士20）：独立函数
  registerEffect({ id: "role:72:settle", source: "character", roleId: "role:72", phase: "settle", timing: "after", run: silverPresidentSettle });
  // role:73 杂志记者（同银行职员02）
  registerEffect({ id: "role:73:reshape", source: "character", roleId: "role:73", phase: "reshape", timing: "before", run: (s, c) => applyToHolders(s, c, "role:73", gainChips(2)) });
  // role:74 游戏制作人（同洗衣房店主13）
  registerActionHook("role:74", "reshuffle", gainChips(1));
  registerActionHook("role:74", "noReshuffle", gainChips(2));
  // role:75 主唱吉他（同酒保04）
  registerEffect({ id: "role:75:swap", source: "character", roleId: "role:75", phase: "swap", timing: "before", run: (s, c) => applyToHolders(s, c, "role:75", setBonus("swapBonus", 1)) });
  registerActionHook("role:75", "swapZero", gainChips(1));
  // role:76 UP主（同清洁工18）
  registerEffect({ id: "role:76:reshape", source: "character", roleId: "role:76", phase: "reshape", timing: "after", run: cleanerReshape, resolve: cleanerReshapeResolve });
  // role:77 快递员（2视为Joker；开局删2张2）
  registerEffect({ id: "role:77:settle", source: "character", roleId: "role:77", phase: "settle", timing: "after", run: role77SettleDelete });
  // role:78 桌游收集者（同矿工06）
  registerEffect({ id: "role:78:duel", source: "character", roleId: "role:78", phase: "duel", timing: "before", run: minerDuel });
  // role:79 魔术师（同魔术师03）
  registerEffect({ id: "role:79:draw", source: "character", roleId: "role:79", phase: "draw", timing: "before", run: (s, c) => applyToHolders(s, c, "role:79", setBonus("handLimitBonus", 1)) });

  // ── 删除钩子：role:67 单独注册 ──────────────────────────────────────────
  registerDeleteHook((state, ctx, cards) => {
    const p = state.players.find((x) => x.id === ctx.playerId);
    if (!p || p.characterId !== "role:67" || p.skillDisabled) return;
    const threes = cards.filter((c) => c.rank === 3).length;
    if (threes > 0) gainChips(threes * 4)(state, ctx);
  });
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

/** role:72 硬银总裁（同武士20）：额外获得本回合获得的车票数量的血筹 */
const silverPresidentSettle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:72", (s, c) => {
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

/** role:19 职业赌徒【对决阶段】前：挂起猜特权证玩家的交互（技能失效时不发动） */
const gamblerDuel: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:19", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    promptChoosePlayer(
      s,
      c.effectId,
      p.id,
      s.players.map((x) => x.id),
      "猜测本回合【临时特权证】的玩家（可以猜自己）",
    );
  });
};

/** role:19 猜测记录：写入 declarations（每回合由 resetTurnState 清空） */
const gamblerDuelResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const targetId = String(choice);
  const target = state.players.find((x) => x.id === targetId);
  p.declarations = { ...(p.declarations ?? {}), "role:19": targetId };
  logText(state, `${p.name} 猜测本回合【临时特权证】玩家为 ${target?.name ?? targetId}`);
};

/** role:19【结算阶段】：猜中本回合特权证持有者则获得（人数+2）血筹 */
const gamblerSettle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:19", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const guess = p.declarations?.["role:19"];
    if (!guess) return;
    const holder = s.players.find((x) => x.seat === s.passHolderSeat);
    if (!holder || holder.id !== guess) return;
    gainChips(s.players.length + 2)(s, c);
  });
};

/**
 * role:16 高中生【对决阶段】前：是否弃置出牌区（弃置后牌型视为高牌 0 点）。
 * 选项顺序约定：options[0] 为默认（不发动），超时托管取它。
 */
const highSchoolDuel: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:16", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.zones.play.length === 0) return;
    promptChooseOption(
      s,
      c.effectId,
      p.id,
      [
        { id: "no", label: "不发动" },
        { id: "yes", label: "弃置出牌区：获得 2 血筹并删除 1 张牌" },
      ],
      "【对决阶段】前：是否弃置出牌区的全部牌？",
    );
  });
};

/**
 * role:16 两段式 resolve：
 * - 第一段 choice = 选项 id（"yes"/"no"）；选 yes 则弃置出牌区 + 2 血筹，并续挂选牌交互；
 * - 第二段 choice = 牌 id 数组（链式挂起），删除其中 1 张。
 */
const highSchoolDuelResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  if (Array.isArray(choice)) {
    const ids = choice.slice(0, 1);
    const moved: Card[] = [];
    for (const id of ids) {
      const idx = p.zones.discard.findIndex((cd) => cd.id === id);
      if (idx === -1) continue;
      const [cd] = p.zones.discard.splice(idx, 1);
      p.zones.deleted.push(cd!);
      delete p.zones.chips[cd!.id];
      moved.push(cd!);
    }
    if (moved.length > 0) {
      logText(state, `${p.name} 删除 1 张牌`);
      afterCardsDeleted(state, ctx, moved);
    }
    return;
  }
  if (choice !== "yes") return;
  clearPlayZone()(state, ctx);
  gainChips(2)(state, ctx);
  if (p.zones.discard.length === 0) return;
  promptChooseCard(
    state,
    ctx.effectId,
    p.id,
    p.zones.discard.map((cd) => cd.id),
    "discard",
    "选择 1 张要删除的牌",
  );
};

/** role:18 清洁工【重整阶段】结束：从全牌库（抽牌堆+弃牌区）挑 1 张删除 */
const cleanerReshape: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:18", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const ids = [...p.zones.draw, ...p.zones.discard].map((cd) => cd.id);
    if (ids.length === 0) return;
    promptChooseCard(s, c.effectId, p.id, ids, "deck", "从全牌库删除 1 张牌（不选则跳过）");
  });
};

/** role:18 删除所选 1 张；若删的是抽牌堆的牌则重洗抽牌堆（chooseCard 超时/不选 = 不删） */
const cleanerReshapeResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const ids = (Array.isArray(choice) ? choice : []).slice(0, 1);
  if (ids.length === 0) return;
  const id = ids[0]!;
  const drawIdx = p.zones.draw.findIndex((cd) => cd.id === id);
  if (drawIdx !== -1) {
    const [cd] = p.zones.draw.splice(drawIdx, 1);
    p.zones.deleted.push(cd!);
    delete p.zones.chips[cd!.id];
    p.zones.draw = shuffle(state, p.zones.draw);
    logText(state, `${p.name} 从抽牌堆删除 1 张牌并重洗抽牌堆`);
    afterCardsDeleted(state, ctx, [cd!]);
    return;
  }
  const discardIdx = p.zones.discard.findIndex((cd) => cd.id === id);
  if (discardIdx === -1) return;
  const [cd] = p.zones.discard.splice(discardIdx, 1);
  p.zones.deleted.push(cd!);
  delete p.zones.chips[cd!.id];
  logText(state, `${p.name} 从弃牌区删除 1 张牌`);
  afterCardsDeleted(state, ctx, [cd!]);
};

/** role:12 炸鸡店老板【结算阶段】结束：候选为本回合打出且仍在弃牌区的牌，血筹不足则不挂起 */
const friedChickenSettle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:12", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const entry = s.duelResult?.find((r) => r.playerId === p.id);
    if (!entry || p.chips < 1) return;
    const ids = entry.cards.map((x) => x.id).filter((id) => p.zones.discard.some((cd) => cd.id === id));
    if (ids.length === 0) return;
    promptChooseCard(s, c.effectId, p.id, ids, "discard", "花 1 血筹删除 1 张本回合打出的牌（最多 3 张）");
  });
};

/** role:12 结算删牌：每张 1 血筹，最多 3 张；血筹不足时按实际张数删 */
const friedChickenSettleResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const ids = (Array.isArray(choice) ? choice : []).slice(0, 3);
  const moved: Card[] = [];
  for (const id of ids) {
    if (p.chips < 1) break;
    const idx = p.zones.discard.findIndex((cd) => cd.id === id);
    if (idx === -1) continue;
    p.chips -= 1;
    const [cd] = p.zones.discard.splice(idx, 1);
    p.zones.deleted.push(cd!);
    delete p.zones.chips[cd!.id];
    moved.push(cd!);
  }
  if (moved.length === 0) return;
  logText(state, `${p.name} 花 ${moved.length} 血筹删除 ${moved.length} 张本回合打出的牌`);
  afterCardsDeleted(state, ctx, moved);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:24 咒术师
// ─────────────────────────────────────────────────────────────────────────────
/** 换牌阶段：可展示手中5置于角色牌下，得1筹抽1张 */
const role24Swap: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:24", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const fives = p.zones.hand.filter((card) => card.rank === 5);
    if (fives.length === 0) return;
    promptChooseCard(s, c.effectId, p.id, fives.map((x) => x.id), "hand", "选择要置于角色牌下的5（不选则跳过）");
  });
};

const role24SwapResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const ids = Array.isArray(choice) ? choice.slice(0, 1) : [];
  if (ids.length === 0) return;
  const id = ids[0]!;
  const idx = p.zones.hand.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const [card] = p.zones.hand.splice(idx, 1);
  // 角色牌下的5：存到新字段 roleTableCards
  p.roleTableCards = p.roleTableCards ?? [];
  p.roleTableCards.push(card);
  gainChips(1)(state, ctx);
  // 抽1张
  if (p.zones.draw.length === 0 && p.zones.discard.length === 0) return;
  if (p.zones.draw.length === 0) p.zones.draw = shuffle(state, p.zones.discard.splice(0));
  p.zones.hand.push(p.zones.draw.shift()!);
  logText(state, `${p.name} 将 ${card.id} 置于角色牌下并抽1张`);
};

/** 换牌阶段结束：可将角色牌下的5收回手牌 */
const role24SwapEnd: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:24", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const fives = (p.roleTableCards ?? []).filter((card) => card.rank === 5);
    if (fives.length === 0) return;
    promptChooseCard(s, c.effectId, p.id, fives.map((x) => x.id), "hand", "将角色牌下的5收回手牌（不选则跳过）");
  });
};

const role24SwapEndResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const ids = Array.isArray(choice) ? choice : [];
  for (const id of ids) {
    const idx = (p.roleTableCards ?? []).findIndex((c) => c.id === id);
    if (idx === -1) continue;
    const [card] = (p.roleTableCards ?? []).splice(idx, 1);
    p.zones.hand.push(card);
  }
  if (ids.length > 0) logText(state, `${p.name} 将 ${ids.length} 张5收回手牌`);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:25 女仆：♥=♠（心形视为黑桃）
// ─────────────────────────────────────────────────────────────────────────────
/** 女仆对决阶段：♥=♠（hand-evaluator 花色计数时处理；此处仅注册阶段标记） */
const role25Duel: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:25", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    p.heartAsSpade = true;
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:30 主播
// ─────────────────────────────────────────────────────────────────────────────
/** 换牌阶段结束：一次性弃置≥2张点数相同的牌得3筹（每回合1次） */
const role30Swap: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:30", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.swapBonusTaken) return;
    // 检查本回合是否有过一次性弃置≥2张相同点数（由 reducer swap 动作中检测）
    if (p.lastSwapHadSameRank && p.lastSwapSameRankCount && p.lastSwapSameRankCount >= 2) {
      p.swapBonusTaken = true;
      gainChips(3)(s, c);
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:31 走私客
// ─────────────────────────────────────────────────────────────────────────────
/** 购买阶段前：指定黑市区1张，本回合购买此牌价格-2；其他玩家购买需先交2筹 */
const role31Purchase: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:31", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const slots = s.blackMarket.slots.filter((slot) => slot.defId !== null);
    if (slots.length === 0) return;
    // 选黑市区栏位（用 from: "market" 时 candidates 为栏位下标字符串）
    const candidates = slots.map((_, i) => String(i));
    promptChooseCard(s, c.effectId, p.id, candidates, "market", "指定黑市区一张牌（你的购买价格-2）");
  });
};

const role31PurchaseResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const idx = Array.isArray(choice) ? parseInt(choice[0] ?? "-1") : parseInt(String(choice));
  if (isNaN(idx) || idx < 0) return;
  const slot = state.blackMarket.slots[idx];
  if (!slot) return;
  // 记录指定栏位（本回合购买时 price-2）
  p.declarations = { ...(p.declarations ?? {}), "role:31:slot": String(idx) };
  logText(state, `${p.name} 指定黑市区第${idx + 1}张，本回合购买价格-2`);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:32 画家
// ─────────────────────────────────────────────────────────────────────────────
/** 对决阶段：出牌区3种花色得2筹，4种花色再得1筹 */
const role32Duel: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:32", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const suits = new Set(p.zones.play.filter((card) => !card.isJoker).map((card) => card.suit));
    if (suits.size >= 3) gainChips(2)(s, c);
    if (suits.size >= 4) gainChips(1)(s, c);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:33 赌神
// ─────────────────────────────────────────────────────────────────────────────
/** 换牌阶段结束：查看所有玩家手牌，额外换牌1次或得1筹 */
const role33SwapEnd: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:33", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    // 先查看所有玩家手牌（公开信息，只是查看）
    for (const player of s.players) {
      logText(s, `${p.name} 查看了 ${player.name} 的手牌：${player.zones.hand.map((x) => x.id).join(", ") || "(空)"}`);
    }
    // 额外换牌或得1筹
    promptChooseOption(s, c.effectId, p.id, [
      { id: "swap", label: "额外进行1次换牌" },
      { id: "chips", label: "获得1血筹" },
    ], "额外换牌还是获得1血筹？");
  });
};

const role33SwapEndResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const id = typeof choice === "string" ? choice : choice[0];
  if (id === "swap") {
    p.swapLeft += 1;
    logText(state, `${p.name} 额外进行1次换牌`);
  } else if (id === "chips") {
    gainChips(1)(state, ctx);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// role:34 质检员
// ─────────────────────────────────────────────────────────────────────────────
/** 重整阶段结束（不重洗时）：将1张弃牌放抽牌堆顶 */
const role34Reshape: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:34", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.zones.discard.length === 0) return;
    promptChooseCard(s, c.effectId, p.id, p.zones.discard.map((x) => x.id), "discard", "选择1张弃牌置于抽牌堆顶（不选则跳过）");
  });
};

const role34ReshapeResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const ids = Array.isArray(choice) ? choice.slice(0, 1) : [];
  if (ids.length === 0) return;
  const id = ids[0]!;
  const idx = p.zones.discard.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const [card] = p.zones.discard.splice(idx, 1);
  p.zones.draw.unshift(card);
  logText(state, `${p.name} 将 ${card.id} 置于抽牌堆顶`);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:35 将军
// ─────────────────────────────────────────────────────────────────────────────
/** 换牌阶段结束：选玩家，其随机弃1摸1，或你额外换牌1次 */
const role35SwapEnd: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:35", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const others = s.players.filter((x) => x.id !== p.id);
    if (others.length === 0) return;
    promptChoosePlayer(s, c.effectId, p.id, others.map((x) => x.id), "选择一位玩家（随机弃1摸1）");
  });
};

const role35SwapEndResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const targetId = typeof choice === "string" ? choice : choice[0];
  if (!targetId) return;
  const target = state.players.find((x) => x.id === targetId);
  if (!target) return;
  // 目标随机弃1摸1
  if (target.zones.hand.length > 0) {
    const idx = nextInt(state, target.zones.hand.length);
    const [card] = target.zones.hand.splice(idx, 1);
    target.zones.discard.push(card);
    logText(state, `${target.name} 随机弃置了 ${card.id}`);
  }
  // 抽1张
  if (target.zones.draw.length === 0 && target.zones.discard.length === 0) return;
  if (target.zones.draw.length === 0) target.zones.draw = shuffle(state, target.zones.discard.splice(0));
  target.zones.hand.push(target.zones.draw.shift()!);
  logText(state, `${target.name} 抽了1张牌`);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:36 票贩子
// ─────────────────────────────────────────────────────────────────────────────
/** 结算阶段：不持特权证可向特权证玩家付3筹强制购买其1车票 */
const role36Settle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:36", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const holder = s.players.find((x) => x.seat === s.passHolderSeat);
    if (!holder || holder.id === p.id) return; // 没有特权证玩家或自己是
    if (p.chips < 3) return;
    promptChooseOption(s, c.effectId, p.id, [
      { id: "no", label: "不发动" },
      { id: "yes", label: "支付3血筹强制购买1车票" },
    ], "是否向特权证玩家支付3血筹强制购买1车票？");
  });
};

const role36SettleResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  if (typeof choice !== "string" || choice !== "yes") return;
  const holder = state.players.find((x) => x.seat === state.passHolderSeat);
  if (!holder || p.chips < 3) return;
  p.chips -= 3;
  holder.tickets -= 1;
  p.tickets += 1;
  logText(state, `${p.name} 向 ${holder.name} 支付3血筹购买了1车票`);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:37 私家侦探
// ─────────────────────────────────────────────────────────────────────────────
/** 抽牌阶段前：可将弃牌区1张放抽牌堆顶，或至多3张放抽牌堆底；未如此做得1筹 */
const role37Draw: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:37", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.zones.discard.length === 0) {
      gainChips(1)(s, c);
      return;
    }
    promptChooseOption(s, c.effectId, p.id, [
      { id: "top1", label: "将1张弃牌放到抽牌堆顶" },
      { id: "bottom3", label: "将至多3张弃牌放到抽牌堆底" },
      { id: "skip", label: "跳过（获得1血筹）" },
    ], "将弃牌区牌放到抽牌堆顶/底，或获得1血筹？");
  });
};

const role37DrawResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const id = typeof choice === "string" ? choice : choice[0];
  if (id === "skip" || !id) { gainChips(1)(state, ctx); return; }
  if (id === "top1") {
    if (p.zones.discard.length === 0) return;
    const card = p.zones.discard.pop()!;
    p.zones.draw.unshift(card);
    logText(state, `${p.name} 将 ${card.id} 置于抽牌堆顶`);
  } else if (id === "bottom3") {
    if (p.zones.discard.length === 0) return;
    const n = Math.min(3, p.zones.discard.length);
    for (let i = 0; i < n; i++) {
      const card = p.zones.discard.pop()!;
      p.zones.draw.push(card);
    }
    logText(state, `${p.name} 将${n}张弃牌放到抽牌堆底`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// role:38 无面人
// ─────────────────────────────────────────────────────────────────────────────
/** 每回合抽牌阶段前：从角色牌堆抽2选1获得技能 */
const role38Draw: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:38", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const deck = state.role38CharacterDeck;
    if (!deck || deck.length < 2) return;
    // 抽2张（从角色堆顶）
    const drawn = [deck.shift()!, deck.shift()!];
    if (drawn.length < 2) { deck.unshift(...drawn); return; }
    // 放入 declarations 供 resolve 使用
    p.declarations = { ...(p.declarations ?? {}), "role:38:drawn": JSON.stringify(drawn.map((x) => x.id)) };
    promptChooseCard(s, c.effectId, p.id, drawn.map((x) => x.id), "hand", "选择1张角色牌获得其技能（持续至下回合抽牌阶段前）");
  });
};

const role38DrawResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const ids = Array.isArray(choice) ? choice.slice(0, 1) : [];
  if (ids.length === 0) return;
  const chosenId = ids[0]!;
  // 从 drawn 中找到这张牌
  const drawnRaw = p.declarations?.["role:38:drawn"];
  if (!drawnRaw) return;
  const drawnIds: string[] = JSON.parse(drawnRaw);
  // 角色牌堆的牌需要从 state.role38CharacterDeck 获取实际 defId
  // 简化处理：直接将 temporaryRoleSource 设为角色名（实际应解析为具体效果）
  p.temporaryRoleSource = chosenId;
  p.roleSkillExpiresAt = "draw";
  logText(state, `${p.name} 获得了角色牌 ${chosenId} 的技能`);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:39 瞎掰王
// ─────────────────────────────────────────────────────────────────────────────
/** 对决阶段前：宣告牌面，从有☠玩家开始顺时针质疑 */
const role39Duel: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:39", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.zones.play.length === 0) return;
    // 宣告内容：记录到 declarations
    const declared = p.zones.play.map((card) => `${card.id}:${card.rank}-${card.suit}`).join(";");
    p.declarations = { ...(p.declarations ?? {}), "role:39:declared": declared };
    logText(s, `${p.name} 宣告出牌区：${declared}`);
    // 从有☠玩家开始顺时针质疑
    const challengers = s.players.filter((x) => x.id !== p.id && (x.zones.hand.some((c) => c.isJoker) || x.characterId === "role:39"));
    if (challengers.length === 0) return;
    promptChoosePlayer(s, c.effectId, p.id, challengers.map((x) => x.id), "是否有玩家质疑？");
  });
};

const role39DuelResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const challengerId = typeof choice === "string" ? choice : choice[0];
  if (!challengerId) {
    // 无人质疑，按宣告对决（出牌区不变）
    logText(state, `${p.name} 的宣告无人质疑`);
    return;
  }
  const challenger = state.players.find((x) => x.id === challengerId);
  if (!challenger) return;
  // 检查出牌区是否与宣告一致
  const declared = (p.declarations?.["role:39:declared"] ?? "").split(";").filter(Boolean);
  const match = declared.every((d) => {
    const [id, rankSuit] = d.split(":");
    const [rank, suit] = rankSuit.split("-");
    const card = p.zones.play.find((c) => c.id === id);
    return card && String(card.rank) === rank && card.suit === suit;
  });
  if (match) {
    gainChips(1)(state, { ...ctx, playerId: challengerId });
    logText(state, `${challenger.name} 质疑失败，交给 ${p.name} 1血筹`);
  } else {
    gainChips(1)(state, ctx);
    logText(state, `${p.name} 的宣告与实际不符，${challenger.name} 获得1血筹`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// role:40 白蔷薇
// ─────────────────────────────────────────────────────────────────────────────
/** 换牌阶段结束：若为第一位宣告换牌结束的玩家，获得3血筹 */
const role40SwapEnd: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:40", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.firstSwapBonusTaken) return;
    // 检查是否为第一个结束换牌的（所有玩家都未结束则本回合可触发）
    // 简化：检查 firstSwapFinisher 是否已被设置
    if (state.firstSwapFinisher && state.firstSwapFinisher !== p.id) return;
    p.firstSwapBonusTaken = true;
    state.firstSwapFinisher = p.id;
    gainChips(3)(s, c);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:41 神作章鱼
// ─────────────────────────────────────────────────────────────────────────────
/** 换牌阶段结束：弃牌区洗混，随机抽至多2张加入手牌 */
const role41SwapEnd: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:41", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.zones.discard.length === 0) return;
    const shuffled = shuffle(state, [...p.zones.discard]);
    const n = Math.min(2, shuffled.length);
    const drawn = shuffled.slice(0, n);
    p.zones.discard = shuffled.slice(n); // 移走抽出的牌
    p.zones.hand.push(...drawn);
    logText(state, `${p.name} 从弃牌区抽了${n}张牌到手牌`);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:42 我的名字？
// ─────────────────────────────────────────────────────────────────────────────
/** 游戏开始时（或第一回合draw前）：自定义牌型名称 */
const role42Start: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:42", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (state.turn !== 1) return;
    // 向玩家询问自定义名称（通过 declarations 暂存默认值，后续替换）
    p.declarations = { ...(p.declarations ?? {}), "role:42:name": "两对" }; // 默认值
    logText(s, `${p.name} 设置了自定义牌型名称：两对（待玩家输入）`);
  });
};

const role42StartResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const name = typeof choice === "string" ? choice : (choice[0] ?? "两对");
  state.role42CustomHandName = name;
  p.declarations = { ...(p.declarations ?? {}), "role:42:name": name };
  logText(state, `${p.name} 将自定义牌型名称设为：${name}`);
};

/** 对决阶段：打出自定义牌型时得2筹（由 whiteboard 结算阶段统一触发，这里仅注册） */
const role42Duel: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:42", (s, c) => {
    // 实际奖励在 resolveDuel 后统一处理，此处暂时占位
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:43 瞎掰帝
// ─────────────────────────────────────────────────────────────────────────────
/** 购买阶段前：查看黑市顶2张选1张暗置，轮流叫价竞拍 */
const role43Purchase: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:43", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const top2 = s.blackMarket.supply.slice(0, 2);
    if (top2.length < 2) return;
    // 先查看再选
    logText(s, `${p.name} 查看了黑市顶2张：${top2.map((x) => x.defId).join(", ")}`);
    promptChooseOption(s, c.effectId, p.id, [
      { id: "first", label: `选第1张（${top2[0]?.defId}）` },
      { id: "second", label: `选第2张（${top2[1]?.defId}）` },
    ], "选择1张暗置在桌面上");
  });
};

const role43PurchaseResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  // 瞎掰帝的完整竞拍需要多轮叫价，超出当前范围，暂记为已选择暗置
  logText(state, `${getPlayer(state, ctx).name} 选择了1张牌暗置（叫价竞拍功能待扩展）`);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:44 窥天师
// ─────────────────────────────────────────────────────────────────────────────
/** 购买阶段：可购买天意，每张价格-2 */
const role44Purchase: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:44", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    // 天意在 state.天意Slots；此处仅提供购买入口（实际购买走标准 purchase 流程）
  });
};

const role44PurchaseResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  // 价格-2 在 characterPurchasePrice 中统一处理
};

// ─────────────────────────────────────────────────────────────────────────────
// role:45 魏王
// ─────────────────────────────────────────────────────────────────────────────
/** 购买阶段结束：若购买过黑市牌获得2血筹 */
const role45PurchaseEnd: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:45", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.boughtMarketThisTurn) {
      gainChips(2)(s, c);
      p.boughtMarketThisTurn = false;
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:46 皇叔
// ─────────────────────────────────────────────────────────────────────────────
/** 结算阶段：检测胜利条件 */
const role46Settle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:46", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    // 胜利条件：车票≥目标数量一半 且 deleted区有54张牌
    const deletedCount = p.zones.deleted.length;
    if (deletedCount >= 54 && p.tickets >= 5) { // 假设目标为10票，一半=5
      s.finished = true;
      s.winners = [p.id];
      logText(state, `${p.name} 达成胜利条件（删牌54张+车票达标）`);
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:47 江东之主
// ─────────────────────────────────────────────────────────────────────────────
/** 结算阶段：持有特权证时获得2血筹 */
const role47Settle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:47", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.seat === s.passHolderSeat) gainChips(2)(s, c);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:48 猪神病人
// ─────────────────────────────────────────────────────────────────────────────
/** 任意时刻（挂在purchase阶段前作为代表）：拍桌子最晚者交血筹 */
const role48Action: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:48", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.pigPatUsedThisTurn) return;
    promptChooseOption(s, c.effectId, p.id, [
      { id: "pat", label: "拍桌子" },
      { id: "skip", label: "跳过" },
    ], "是否大喊并拍桌子？");
  });
};

const role48ActionResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  if (typeof choice !== "string" || choice !== "pat") return;
  p.pigPatUsedThisTurn = true;
  const lastPat = p.lastPigPattedBy;
  const amount = lastPat ? 1 : 2;
  // 找出最晚响应的玩家（实际需全员响应，此处简化为随机选一个）
  const others = state.players.filter((x) => x.id !== p.id);
  if (others.length === 0) return;
  const loser = others[nextInt(state, others.length)!];
  const actual = Math.min(amount, loser.chips);
  loser.chips -= actual;
  p.chips += actual;
  p.lastPigPattedBy = loser.id;
  logText(state, `${p.name} 拍了桌子，${loser.name} 最晚响应，交给 ${p.name} ${actual} 血筹`);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:49 地下城主
// ─────────────────────────────────────────────────────────────────────────────
/** 换牌阶段前：掷骰，≥3本回合换牌次数调整为该点数，<3得该点数血筹 */
const role49Swap: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:49", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const roll = rollDice(s);
    logText(s, `${p.name} 掷出${roll}点`);
    if (roll >= 3) {
      p.swapLeft = roll;
      logText(s, `${p.name} 本回合换牌次数调整为${roll}`);
    } else {
      gainChips(roll)(s, c);
    }
  });
};

const role49SwapResolve = (_state: GameState, _ctx: EffectContext, _choice: string | string[]): void => {
  // 已在 run 中直接处理
};

// ─────────────────────────────────────────────────────────────────────────────
// role:50 霸道总裁
// ─────────────────────────────────────────────────────────────────────────────
/** 换牌阶段结束：依次选玩家交给其任意血筹；对方选择收下（丢弃手牌抽等量）或拒绝（付双倍） */
const role50SwapEnd: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:50", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const others = s.players.filter((x) => x.id !== p.id && x.chips > 0);
    if (others.length === 0) return;
    promptChoosePlayer(s, c.effectId, p.id, others.map((x) => x.id), "选择一位玩家交给血筹");
  });
};

const role50SwapEndResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const targetId = typeof choice === "string" ? choice : choice[0];
  if (!targetId) return;
  const target = state.players.find((x) => x.id === targetId);
  if (!target) return;
  // 目标选择：收下（丢弃手牌抽等量）或拒绝（付双倍）
  promptChooseOption(state, ctx.effectId, target.id, [
    { id: "accept", label: "收下（丢弃所有手牌，抽取等量）" },
    { id: "refuse", label: "拒绝（支付双倍血筹）" },
  ], `${p.name} 想给你血筹，如何选择？`);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:51 无业游民
// ─────────────────────────────────────────────────────────────────────────────
/** 换牌阶段结束：从对手抽牌区抽共2张 */
const role51SwapEnd: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:51", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const others = s.players.filter((x) => x.id !== p.id && x.zones.draw.length >= 2);
    if (others.length === 0) return;
    promptChoosePlayer(s, c.effectId, p.id, others.map((x) => x.id), "从哪位对手的抽牌区抽牌？");
  });
};

const role51SwapEndResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const targetId = typeof choice === "string" ? choice : choice[0];
  if (!targetId) return;
  const target = state.players.find((x) => x.id === targetId);
  if (!target || target.zones.draw.length < 2) return;
  const n = Math.min(2, target.zones.draw.length);
  for (let i = 0; i < n; i++) {
    const card = target.zones.draw.shift()!;
    p.zones.hand.push(card);
  }
  // 记录对手牌在出牌区（用于对决阶段）
  p.opponentCardFrom51 = targetId;
  logText(state, `${p.name} 从 ${target.name} 的抽牌区抽了${n}张牌`);
};

/** 对决阶段：出牌区每有对手1张牌，该对手给1筹 */
const role51Duel: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:51", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const opponentId = p.opponentCardFrom51;
    if (!opponentId) return;
    const opponent = s.players.find((x) => x.id === opponentId);
    if (!opponent) return;
    const myCards = p.zones.play.filter((card) => card.fromPlayerId === opponentId);
    const amount = myCards.length;
    if (amount > 0 && opponent.chips >= amount) {
      opponent.chips -= amount;
      p.chips += amount;
      logText(s, `${opponent.name} 因 ${p.name} 出牌区有其${amount}张牌，交给${p.name}${amount}血筹`);
    }
  });
};

/** 结算阶段结束：将对手的牌放回对手弃牌区 */
const role51Settle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:51", (s, c) => {
    const p = getPlayer(s, c);
    const opponentId = p.opponentCardFrom51;
    if (!opponentId) return;
    const opponent = s.players.find((x) => x.id === opponentId);
    if (!opponent) return;
    const myCards = p.zones.play.filter((card) => (card as any).fromPlayerId === opponentId);
    for (const card of myCards) {
      const idx = p.zones.play.findIndex((c) => c.id === card.id);
      if (idx !== -1) {
        const [c] = p.zones.play.splice(idx, 1);
        opponent.zones.discard.push(c);
      }
    }
    p.opponentCardFrom51 = undefined;
    logText(state, `${p.name} 将 ${opponent.name} 的牌放回了弃牌区`);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:52 编剧
// ─────────────────────────────────────────────────────────────────────────────
/** 对决阶段后：总点数恰好50得5筹；否则跳过购买+删牌阶段 */
const role52Duel: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:52", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.编剧BonusTaken) return;
    const entry = s.duelResult?.find((r) => r.playerId === p.id);
    if (!entry) return;
    if (entry.totalPoints === 50) {
      p.编剧BonusTaken = true;
      gainChips(5)(s, c);
    } else {
      // 跳过本回合购买和删牌阶段
      p.skipPhases = [...(p.skipPhases ?? []), "purchase", "delete"];
      logText(s, `${p.name} 总点数不为50，跳过本回合购买和删牌阶段`);
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:53 双重人格公主
// ─────────────────────────────────────────────────────────────────────────────
/** 对决阶段：根据当前人格应用效果 */
const role53Duel: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:53", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.currentPersona !== "normal" && p.currentPersona !== "manic") {
      p.currentPersona = "normal"; // 默认常时人格
      p.personaDiscardFaceUp = false;
    }
    const played = p.zones.play;
    if (played.length === 0) return;
    if (p.currentPersona === "normal") {
      // 常时人格：出牌均为黑色得3血筹
      const allBlack = played.every((card) => !card.isJoker && (card.suit === "S" || card.suit === "C"));
      if (allBlack) gainChips(3)(s, c);
    } else {
      // 躁狂人格：出牌均为红色得1车票
      const allRed = played.every((card) => !card.isJoker && (card.suit === "H" || card.suit === "D"));
      if (allRed) {
        p.tickets += 1;
        logText(s, `${p.name} 躁狂人格生效，获得1车票`);
      }
    }
  });
};

/** 结算阶段后：切换人格 */
const role53Settle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:53", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    // 使用技能后切换（简化：结算后自动切换）
    if (p.currentPersona === "normal") {
      p.currentPersona = "manic";
      p.personaDiscardFaceUp = true;
    } else {
      p.currentPersona = "normal";
      p.personaDiscardFaceUp = false;
    }
    logText(s, `${p.name} 切换为${p.currentPersona === "normal" ? "常时" : "躁狂"}人格`);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:54 入殓师
// ─────────────────────────────────────────────────────────────────────────────
/** 换牌阶段：特殊换牌（至多3张手牌置于角色牌上，从弃牌区随机抽等量） */
const role54Swap: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:54", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.zones.hand.length === 0) return;
    promptChooseOption(s, c.effectId, p.id, [
      { id: "special", label: "特殊换牌（置最多3张到角色牌上）" },
      { id: "normal", label: "普通换牌" },
    ], "是否使用特殊换牌？");
  });
};

const role54SwapResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const id = typeof choice === "string" ? choice : choice[0];
  if (id === "normal" || !id) return;
  // 特殊换牌：选至多3张手牌
  promptChooseCard(state, ctx.effectId, p.id, p.zones.hand.map((x) => x.id), "hand", "选择至多3张手牌置于角色牌上");
};

const role54SwapEnd: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:54", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    // 将角色牌上的牌置入弃牌区
    const onChar = p.role54OnCharacter ?? [];
    for (const card of onChar) {
      p.zones.discard.push(card);
    }
    if (onChar.length > 0) {
      p.role54OnCharacter = [];
      logText(state, `${p.name} 将${onChar.length}张牌从角色牌上置入弃牌区`);
    }
    // 未使用特殊换牌得2筹
    if (!p.role54UsedSpecial) {
      gainChips(2)(s, c);
    }
    p.role54UsedSpecial = false;
  });
};

const role54SwapEndResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  // 已在角色牌上的牌处理
};

// ─────────────────────────────────────────────────────────────────────────────
// role:55 赌狗
// ─────────────────────────────────────────────────────────────────────────────
/** 删牌阶段：选玩家，该玩家掷骰，删其抽牌堆顶(X-1)张 */
const role55Delete: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:55", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const others = s.players.filter((x) => x.id !== p.id);
    if (others.length === 0) return;
    promptChoosePlayer(s, c.effectId, p.id, others.map((x) => x.id), "选择一位玩家掷骰");
  });
};

const role55DeleteResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const targetId = typeof choice === "string" ? choice : choice[0];
  if (!targetId) return;
  const target = state.players.find((x) => x.id === targetId);
  if (!target) return;
  const roll = rollDice(state);
  const toDelete = Math.min(roll - 1, target.zones.draw.length);
  logText(state, `${target.name} 掷出${roll}点，删除${toDelete}张`);
  for (let i = 0; i < toDelete; i++) {
    if (target.zones.draw.length === 0) break;
    const [card] = target.zones.draw.shift()!;
    target.zones.deleted.push(card);
    afterCardsDeleted(state, { ...ctx, playerId: targetId }, [card]);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// role:56 特工
// ─────────────────────────────────────────────────────────────────────────────
/** 出牌阶段结束：询问是否交换出牌区 */
const role56Play: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:56", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.zones.play.length === 0) return;
    const others = s.players.filter((x) => x.id !== p.id && x.zones.play.length > 0);
    if (others.length === 0) return;
    promptChoosePlayer(s, c.effectId, p.id, others.map((x) => x.id), "指定一位玩家询问是否交换出牌区");
  });
};

const role56PlayResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const targetId = typeof choice === "string" ? choice : choice[0];
  if (!targetId) return;
  const target = state.players.find((x) => x.id === targetId);
  if (!target) return;
  promptChooseOption(state, ctx.effectId, target.id, [
    { id: "accept", label: "交换出牌区" },
    { id: "refuse", label: "拒绝（给对方2血筹）" },
  ], `${p.name} 想与你交换出牌区，如何选择？`);
  // 记录待交换
  p.declarations = { ...(p.declarations ?? {}), "role:56:target": targetId };
};

const role56Settle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:56", (s, c) => {
    const p = getPlayer(s, c);
    const targetId = p.declarations?.["role:56:target"];
    if (!targetId) return;
    const target = s.players.find((x) => x.id === targetId);
    if (!target) return;
    // 归还交换的牌
    const myCards = [...p.zones.play];
    const targetCards = [...target.zones.play];
    p.zones.play.length = 0;
    target.zones.play.length = 0;
    p.zones.play.push(...targetCards);
    target.zones.play.push(...myCards);
    logText(state, `${p.name} 和 ${target.name} 归还了交换的出牌区`);
    p.declarations = { ...(p.declarations ?? {}), "role:56:target": "" };
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:57 咖啡师
// ─────────────────────────────────────────────────────────────────────────────
/** 购买阶段结束：第一次购买原价格≥3的黑市牌时，免费获得黑市堆顶1张 */
const role57PurchaseEnd: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:57", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (!p.coffeeUsedThisTurn && p.lastPurchasePrice && p.lastPurchasePrice >= 3) {
      if (s.blackMarket.supply.length > 0) {
        const free = s.blackMarket.supply.shift()!;
        p.zones.hand.push(free as any);
        logText(s, `${p.name} 获得免费黑市牌 ${(free as any).defId}`);
      }
      p.coffeeUsedThisTurn = true;
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:58 魅魔
// ─────────────────────────────────────────────────────────────────────────────
/** 结算阶段：持特权证抢♂3筹，不持抢♀1筹 */
const role58Settle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:58", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const hasPass = p.seat === s.passHolderSeat;
    const targets = s.players.filter((x) => {
      if (x.id === p.id) return false;
      if (hasPass) return x.gender === "M";
      return x.gender === "F" || x.gender === "?";
    });
    if (targets.length === 0) {
      // 无法抢夺则改为获得等量
      gainChips(hasPass ? 3 : 1)(s, c);
      return;
    }
    promptChoosePlayer(s, c.effectId, p.id, targets.map((x) => x.id), `选择目标（${hasPass ? "♂" : "♀"}）`);
  });
};

const role58SettleResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const targetId = typeof choice === "string" ? choice : choice[0];
  if (!targetId) return;
  const target = state.players.find((x) => x.id === targetId);
  if (!target) return;
  const hasPass = p.seat === state.passHolderSeat;
  const amount = hasPass ? 3 : 1;
  const actual = Math.min(amount, target.chips);
  target.chips -= actual;
  p.chips += actual;
  logText(state, `${p.name} 从 ${target.name} 抢夺了${actual}血筹`);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:59 炸弹客
// ─────────────────────────────────────────────────────────────────────────────
/** 换牌阶段前：申报0-2中数字X，获得X血筹 */
const role59Swap: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:59", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    promptChooseOption(s, c.effectId, p.id, [
      { id: "0", label: "申报0" },
      { id: "1", label: "申报1" },
      { id: "2", label: "申报2" },
    ], "申报哪个数字？");
  });
};

const role59SwapResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const id = typeof choice === "string" ? choice : choice[0];
  const x = parseInt(id ?? "0", 10);
  if (isNaN(x)) return;
  p.declarations = { ...(p.declarations ?? {}), "role:59:X": String(x) };
  if (x > 0) gainChips(x)(state, ctx);
  logText(state, `${p.name} 申报了${x}，获得${x}血筹`);
};

/** 结算阶段结束：其他玩家随机删X张，自己删X+1张 */
const role59Settle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:59", (s, c) => {
    const p = getPlayer(s, c);
    const x = parseInt(p.declarations?.["role:59:X"] ?? "0", 10);
    // 其他玩家各随机删X张
    for (const other of s.players) {
      if (other.id === p.id) continue;
      const toDelete = Math.min(x, other.zones.play.length);
      const shuffled = shuffle(state, [...other.zones.play]);
      for (let i = 0; i < toDelete; i++) {
        const [card] = shuffled.splice(0, 1);
        const idx = other.zones.play.findIndex((c) => c.id === card?.id);
        if (idx !== -1) {
          other.zones.play.splice(idx, 1);
          other.zones.deleted.push(card!);
          afterCardsDeleted(s, { ...ctx, playerId: other.id }, [card!]);
        }
      }
    }
    // 自己删X+1张
    const myDelete = Math.min(x + 1, p.zones.play.length);
    const myShuffled = shuffle(state, [...p.zones.play]);
    for (let i = 0; i < myDelete; i++) {
      const [card] = myShuffled.splice(0, 1);
      if (!card) continue;
      const idx = p.zones.play.findIndex((c) => c.id === card.id);
      if (idx !== -1) {
        p.zones.play.splice(idx, 1);
        p.zones.deleted.push(card);
        afterCardsDeleted(s, ctx, [card]);
      }
    }
    logText(state, `${p.name}(炸弹客)结算：其他玩家各删${x}张，自己删${myDelete}张`);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:60 资本家
// ─────────────────────────────────────────────────────────────────────────────
/** 每个阶段结束后：1车票换4血筹，或8血筹换1车票 */
const role60PhaseEnd: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:60", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.exchangeThisPhase) return;
    // 提供兑换选项（实际由UI触发，此处占位）
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:61 风水师
// ─────────────────────────────────────────────────────────────────────────────
/** 购买阶段结束：剩余0血筹获得3血筹 */
const role61PurchaseEnd: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:61", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.chips === 0) gainChips(3)(s, c);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:62 退堂鼓选手
// ─────────────────────────────────────────────────────────────────────────────
/** 结算阶段结束：花1筹删1张本回合打出的牌（最多3张） */
const role62Settle: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:62", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const entry = s.duelResult?.find((r) => r.playerId === p.id);
    if (!entry || p.chips < 1) return;
    const ids = entry.cards.map((x) => x.id).filter((id) => p.zones.discard.some((cd) => cd.id === id));
    if (ids.length === 0) return;
    promptChooseCard(s, c.effectId, p.id, ids, "discard", "花1血筹删除1张（最多3张）");
  });
};

const role62SettleResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const ids = (Array.isArray(choice) ? choice : []).slice(0, 3);
  for (const id of ids) {
    if (p.chips < 1) break;
    const idx = p.zones.discard.findIndex((cd) => cd.id === id);
    if (idx === -1) continue;
    p.chips -= 1;
    const [cd] = p.zones.discard.splice(idx, 1);
    p.zones.deleted.push(cd!);
    delete p.zones.chips[cd!.id];
    afterCardsDeleted(state, ctx, [cd!]);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// role:64 格斗家（类似海盗08的抢劫）
// ─────────────────────────────────────────────────────────────────────────────
/** 购买阶段前：抢劫（放弃交2筹/抵抗掷骰抢至多4筹） */
const role64Purchase: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:64", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    const others = s.players.filter((x) => x.id !== p.id && x.chips > 0);
    if (others.length === 0) return;
    promptChoosePlayer(s, c.effectId, p.id, others.map((x) => x.id), "选择抢劫目标");
  });
};

const role64PurchaseResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const targetId = typeof choice === "string" ? choice : choice[0];
  if (!targetId) return;
  const target = state.players.find((x) => x.id === targetId);
  if (!target) return;
  promptChooseOption(state, ctx.effectId, target.id, [
    { id: "surrender", label: "放弃（交2血筹）" },
    { id: "resist", label: "抵抗（掷骰）" },
  ], `${p.name} 想抢劫你，如何选择？`);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:65 魔法少女（同枪手17：4视为Joker；结算结束删除）
// ─────────────────────────────────────────────────────────────────────────────
const role65SettleDelete: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:65", (s, c) => {
    const p = getPlayer(s, c);
    const entry = s.duelResult?.find((r) => r.playerId === p.id);
    if (!entry) return;
    const ids = entry.cards
      .filter((rc) => rc.wasJoker && rc.rank !== 4 && findCardInZones(p, rc.id)?.rank === 4)
      .map((rc) => rc.id);
    for (const id of ids) deleteFromDiscard(id)(s, c);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// role:66 烂泥（类似高中生16）
// ─────────────────────────────────────────────────────────────────────────────
/** 对决阶段前：弃置出牌区全部牌，得2筹，可删1张 */
const role66Duel: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:66", (s, c) => {
    const p = getPlayer(s, c);
    if (p.skillDisabled) return;
    if (p.zones.play.length === 0) return;
    clearPlayZone()(s, c);
    gainChips(2)(s, c);
    // 可执行一次删牌（freeDeleteExtra 已由 roleTurnSetup 设置）
    if (p.zones.discard.length > 0 && (p.freeDeleteExtra ?? 0) > 0) {
      promptChooseCard(s, c.effectId, p.id, p.zones.discard.map((x) => x.id), "discard", "选择1张要删除的牌（不选则跳过）");
    }
  });
};

const role66DuelResolve = (state: GameState, ctx: EffectContext, choice: string | string[]): void => {
  const p = getPlayer(state, ctx);
  const ids = Array.isArray(choice) ? choice.slice(0, 1) : [];
  if (ids.length === 0) return;
  const id = ids[0]!;
  const idx = p.zones.discard.findIndex((cd) => cd.id === id);
  if (idx === -1) return;
  const [cd] = p.zones.discard.splice(idx, 1);
  p.zones.deleted.push(cd!);
  delete p.zones.chips[cd!.id];
  afterCardsDeleted(state, ctx, [cd!]);
  logText(state, `${p.name} 删除了1张牌`);
};

// ─────────────────────────────────────────────────────────────────────────────
// role:77 快递员（2视为Joker；开局删2张2）
// ─────────────────────────────────────────────────────────────────────────────
const role77SettleDelete: EffectBody = (state, ctx) => {
  applyToHolders(state, ctx, "role:77", (s, c) => {
    const p = getPlayer(s, c);
    const entry = s.duelResult?.find((r) => r.playerId === p.id);
    if (!entry) return;
    const ids = entry.cards
      .filter((rc) => rc.wasJoker && rc.rank !== 2 && findCardInZones(p, rc.id)?.rank === 2)
      .map((rc) => rc.id);
    for (const id of ids) deleteFromDiscard(id)(s, c);
  });
};

registerRoleEffects();
