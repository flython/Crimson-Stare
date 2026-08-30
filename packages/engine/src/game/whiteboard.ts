/**
 * 票据 02 — 白板局 reducer（M2 已接入角色 setup / 黑市购买处理 / 效果接入点）。
 *
 * 模型：reduce(state, action, config) → 新 state（纯函数，入参不改）。
 * Action 流 + 初始 rngState 即可完整重放一局。
 * 角色/黑市效果本体在 effects/roles.ts、effects/market.ts（票据 11/12），本文件只挂接入点。
 */
import type { Card } from "../cards.js";
import { card, joker, SUITS } from "../cards.js";
import type { GameConfig } from "../core/config.js";
import type { GameState, PlayerState, PhaseId, Suspended } from "../core/state.js";
import { shuffle } from "../core/rng.js";
import { evaluateHand, compareHands } from "../hand-evaluator.js";
import type { ChipView } from "../hand-evaluator.js";
import { resolveTiming, runTimingQueue, runActionHook, getEffect } from "../core/effects.js";
import { validateChoice } from "../effects/interactive.js";
import { afterCardsDeleted } from "../effects/primitives.js";
import { roleSetup, roleChipView, roleTurnSetup, characterPurchasePrice } from "../effects/roles.js";
import type { DuelResultEntry } from "../core/state.js";
import type { CardPool } from "../cardPool.js";

export type Action =
  | { type: "swap"; playerId: string; discardIds: string[] }
  /** 塔罗师（role:10）：先抽 2 张再弃至多 2 张，消耗 1 次换牌 */
  | { type: "swapDrawFirst"; playerId: string; discardIds: string[] }
  /** 炸鸡店老板（role:12）：花 1 血筹抽 1 张，不消耗换牌次数、无次数限制 */
  | { type: "buyDraw"; playerId: string }
  | { type: "stopSwap"; playerId: string }
  | { type: "playCards"; playerId: string; cardIds: string[] }
  | { type: "purchase"; playerId: string; slotIndex: number }
  | { type: "skipPurchase"; playerId: string }
  | { type: "deleteCards"; playerId: string; cardIds: string[] }
  | { type: "ready"; playerId: string }
  | { type: "reshape"; playerId: string; reshuffle: boolean }
  | { type: "resolvePrompt"; playerId: string; choice: string | string[] };

/** 一副 54 张标准扑克（2-14 × 4 花色 + 双王） */
function buildDeck(playerIdx: number): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push(card(rank, suit, `p${playerIdx}-${suit}${rank}`));
    }
  }
  deck.push(joker(`p${playerIdx}-JOKER-a`));
  deck.push(joker(`p${playerIdx}-JOKER-b`));
  return deck;
}

function newPlayer(id: string, name: string, seat: number): PlayerState {
  return {
    id,
    name,
    seat,
    characterId: null,
    chips: 0,
    tickets: 0,
    swapLeft: 0,
    purchaseFlipped: false,
    phaseReady: false,
    zones: { draw: [], hand: [], discard: [], play: [], deleted: [], chips: {}, items: [] },
  };
}

function log(state: GameState, text: string): void {
  state.log.push({ turn: state.turn, phase: state.phase, text });
}

/**
 * 回合级状态复位（票据 20）。
 * 每回合进入 draw 时执行：清理上回合的一次性标记，并把"下回合"类延迟效果落到本回合。
 */
function resetTurnState(state: GameState, config: GameConfig): void {
  for (const p of state.players) {
    // 延迟生效：下回合技能失效（暂时失忆）；其余"下回合"标记本回合末即失效
    p.skillDisabled = p.nextTurnSkillDisabled ? true : undefined;
    p.nextTurnSkillDisabled = false;
    p.chipsDisabled = undefined; // 磁山隧道等：芯片失效仅持续一回合
    p.nextTurnSwapDelta = 0; // 换牌次数修正已在进入 swap 阶段时消费
    p.ticketsGainedThisTurn = 0;
    p.purchasedThisTurn = false;
    p.skipPhases = [];
    p.declarations = {};
    p.disabledChipCards = [];
    roleTurnSetup(p); // 角色常驻能力（黑客免费删牌额度、塔罗师/偶像换牌变体）
  }
  state.duelResult = [];
  void config;
}

/** 抽牌至手牌上限（手牌上限 = 基础 + 角色加成，魔术师 +1）；抽牌堆不足时先重洗弃牌堆 */
function drawToHandLimit(state: GameState, p: PlayerState, config: GameConfig): void {
  const limit = config.handLimit + (p.handLimitBonus ?? 0);
  while (p.zones.hand.length < limit) {
    if (p.zones.draw.length === 0) {
      if (p.zones.discard.length === 0) return; // 无牌可抽（牌打空的现实边界）
      p.zones.draw = shuffle(state, p.zones.discard.splice(0));
      log(state, `${p.name} 重洗弃牌堆组成新抽牌堆`);
      runActionHook(state, p.characterId, "reshuffle", config, p.id); // 洗衣房店主：重洗得 1 血筹
    }
    p.zones.hand.push(p.zones.draw.shift()!);
  }
}

/** 抽 n 张（抽牌堆不足时重洗弃牌堆；两者皆空则少抽，不做补齐） */
function drawCards(state: GameState, p: PlayerState, config: GameConfig, n: number): void {
  for (let i = 0; i < n; i++) {
    if (p.zones.draw.length === 0) {
      if (p.zones.discard.length === 0) return;
      p.zones.draw = shuffle(state, p.zones.discard.splice(0));
      log(state, `${p.name} 重洗弃牌堆组成新抽牌堆`);
      runActionHook(state, p.characterId, "reshuffle", config, p.id); // 洗衣房店主：重洗得 1 血筹
    }
    p.zones.hand.push(p.zones.draw.shift()!);
  }
}

function findPlayer(state: GameState, playerId: string): PlayerState {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) throw new Error(`玩家不存在: ${playerId}`);
  return p;
}

function allReady(state: GameState): boolean {
  return state.players.every((p) => p.phaseReady);
}

function runHooks(state: GameState, timing: "before" | "after", config: GameConfig): void {
  runTimingQueue(state, resolveTiming(state, state.phase, timing, config), config);
}

/**
 * 阶段推进点（票据 20）：钩子可能挂起交互（如"对决前猜测"），此时主体必须等 resolvePrompt 后再跑。
 * 挂起则记录位置并返回；否则立即执行主体。
 */
function advance(state: GameState, mark: Suspended, fn: () => void): void {
  if (state.pendingPrompt) {
    state.suspended = mark;
    return;
  }
  fn();
}

/** 离开当前阶段：先跑 after 钩子，再进入下一阶段（可被交互挂起） */
function leavePhase(state: GameState, config: GameConfig, nextPhase: PhaseId): void {
  const from = state.phase;
  runHooks(state, "after", config);
  advance(state, { phase: from, step: "afterDone" }, () => enterPhase(state, nextPhase, config));
}

/** 交互解除后继续被挂起的阶段推进（票据 20） */
function resumePhase(state: GameState, config: GameConfig): void {
  const s = state.suspended;
  if (!s) return;
  state.suspended = undefined;
  const key = `${s.phase}:${s.step}`;
  switch (key) {
    case "swap:afterDone":
      return enterPhase(state, "play", config);
    case "play:afterDone":
      return enterPhase(state, "duel", config);
    case "duel:beforeDone":
      return duelMain(state, config);
    case "duel:afterDone":
      return enterPhase(state, "settle", config);
    case "settle:afterDone":
      if (!state.finished) enterPhase(state, "purchase", config);
      return;
    case "purchase:afterDone":
      applyPurchaseEndBonus(state, config);
      return enterPhase(state, "delete", config);
    case "delete:afterDone":
      return enterPhase(state, "reshape", config);
    case "reshape:afterDone":
      state.turn += 1;
      log(state, `—— 第 ${state.turn} 回合 ——`);
      return enterPhase(state, "draw", config);
    default:
      return; // 未知挂起点：不推进（保守，宁可卡住也不乱推进）
  }
}

function enterPhase(state: GameState, phase: PhaseId, config: GameConfig): void {
  state.phase = phase;
  for (const p of state.players) {
    p.phaseReady = false;
    if (phase === "swap") {
      // 换牌次数 = 基础（持证者+1）+ 角色加成（酒保+1）+ 上回合施加的修正（餐车投毒 -2）
      p.swapLeft = Math.max(
        0,
        (p.seat === state.passHolderSeat ? config.swapCountWithPass : config.swapCount) +
          (p.swapBonus ?? 0) +
          (p.nextTurnSwapDelta ?? 0),
      );
      p.nextTurnSwapDelta = 0;
    }
    if (phase === "purchase") p.purchaseFlipped = false;
  }

  if (phase === "draw") {
    resetTurnState(state, config);
    runHooks(state, "before", config);
    for (const p of state.players) drawToHandLimit(state, p, config);
    runHooks(state, "after", config);
    enterPhase(state, "swap", config); // 抽牌无玩家交互，直接推进
    return;
  }
  if (phase === "duel") {
    runHooks(state, "before", config); // 交互可在此挂起（职业赌徒猜特权证 / 高中生弃出牌区）
    advance(state, { phase: "duel", step: "beforeDone" }, () => duelMain(state, config));
    return;
  }
  if (phase === "settle") {
    runHooks(state, "before", config);
    checkVictory(state, config);
    runHooks(state, "after", config); // 交互可在此挂起（炸鸡店老板结算删牌）
    advance(state, { phase: "settle", step: "afterDone" }, () => {
      if (!state.finished) enterPhase(state, "purchase", config);
    });
    return;
  }
  if (phase === "reshape") {
    runHooks(state, "before", config); // 角色阶段效果（银行职员【重整阶段】+2 血筹）
    return; // 等玩家 reshape 决策
  }
  // swap / play / purchase / delete：等待玩家 Action
}

/**
 * 对决自动结算（票据 20：注入角色判定视图 → 求解 → 记账 duelResult 与本回合所得车票）。
 * 角色映射（2 视为 5 / 6↔9 / 4 视为小丑）由求解器直接取最优，无需玩家交互：
 * 视为 JOKER 的候选集包含其原值，故"全部纳入"只会让结果更好或相等。
 */
function resolveDuel(state: GameState, config: GameConfig): void {
  const evaluated = state.players.map((p) => {
    const view: ChipView | undefined = roleChipView(p);
    const ev = p.zones.play.length > 0 ? evaluateHand(p.zones.play, view) : null;
    if (ev && (p.duelPointsBonus ?? 0) !== 0) {
      ev.totalPoints += p.duelPointsBonus!; // 赌场荷官【结算阶段】牌型总点数+20
    }
    return { p, ev };
  });
  const n = state.players.length;
  const holder = state.passHolderSeat ?? 0;
  // 牌型降序 → 总点数降序 → 顺时针离特权证近者先
  evaluated.sort((a, b) => {
    if (!a.ev && !b.ev) return 0;
    if (!a.ev) return 1;
    if (!b.ev) return -1;
    const c = compareHands(b.ev, a.ev); // compareHands 正数=前者大
    if (c !== 0) return c;
    return (a.p.seat - holder + n) % n - ((b.p.seat - holder + n) % n);
  });

  const results: DuelResultEntry[] = [];
  evaluated.forEach(({ p, ev }, idx) => {
    const rank = idx + 1;
    const reward = config.rankRewards[String(n)]?.find((r) => r.rank === rank);
    if (reward) {
      p.tickets += reward.tickets;
      p.ticketsGainedThisTurn = (p.ticketsGainedThisTurn ?? 0) + reward.tickets;
      p.chips += reward.chips;
      log(state, `${p.name} 第${rank}名：+${reward.tickets}票 +${reward.chips}筹`);
    }
    if (rank === 1) {
      state.passHolderSeat = p.seat;
      log(state, `${p.name} 夺魁，获得临时特权证`);
    }
    if (ev) {
      results.push({
        playerId: p.id,
        category: ev.category,
        totalPoints: ev.totalPoints,
        rank,
        cards: ev.cards.map((c) => ({ id: c.id, rank: c.rank, suit: c.suit, wasJoker: c.wasJoker })),
      });
    }
    p.zones.discard.push(...p.zones.play.splice(0)); // 出牌区置入弃牌区
  });
  state.duelResult = results;
}

/** 对决主体：判定 → 名次结算 → after 钩子 → 进入结算阶段（与 duel/before 钩子分开，便于挂起后恢复） */
function duelMain(state: GameState, config: GameConfig): void {
  resolveDuel(state, config);
  runHooks(state, "after", config);
  advance(state, { phase: "duel", step: "afterDone" }, () => enterPhase(state, "settle", config));
}

function checkVictory(state: GameState, config: GameConfig): void {
  const goal = config.ticketGoals[String(state.players.length)];
  if (goal === undefined) return;
  const reached = state.players.filter((p) => p.tickets >= goal);
  if (reached.length === 0) return;
  const max = Math.max(...state.players.map((p) => p.tickets));
  state.winners = state.players.filter((p) => p.tickets === max).map((p) => p.id);
  state.finished = true;
  log(state, `游戏结束，目标 ${goal} 票，胜者: ${state.winners.join(", ")}`);
}

/** 购买阶段结束：最右两格叠加血筹（规则 6） */
function applyPurchaseEndBonus(state: GameState, config: GameConfig): void {
  for (const slotNo of config.blackMarketBonusSlots) {
    const slot = state.blackMarket.slots[slotNo - 1];
    if (slot && slot.defId) {
      slot.bonusChips += config.blackMarketBonusChips;
    }
  }
}

function endPurchasePhase(state: GameState, config: GameConfig): void {
  runHooks(state, "after", config); // 交互可在此挂起（海盗抢劫等购买末交互）
  advance(state, { phase: "purchase", step: "afterDone" }, () => {
    applyPurchaseEndBonus(state, config);
    enterPhase(state, "delete", config);
  });
}

function endTurn(state: GameState, config: GameConfig): void {
  runHooks(state, "after", config); // 交互可在此挂起（清洁工重整末删牌）
  advance(state, { phase: "reshape", step: "afterDone" }, () => {
    state.turn += 1;
    log(state, `—— 第 ${state.turn} 回合 ——`);
    enterPhase(state, "draw", config);
  });
}

function refillSlot(state: GameState, slotIndex: number): void {
  const next = state.blackMarket.supply.shift();
  const slot = state.blackMarket.slots[slotIndex];
  if (!slot) return;
  if (next) {
    slot.defId = next.defId;
    slot.price = next.price;
    slot.bonusChips = 0;
    slot.subtype = next.subtype;
  } else {
    slot.defId = null; // 黑市买空不补齐（规则 6）
  }
}

/**
 * 黑市牌购买处理（M2.3 骨架）：按注册表分发。
 * - 效果已注册（market:<defId>，秘密交易立即结算 / 强化芯片插入交互）→ 调 run（可能挂起等选牌）
 * - 备用道具 → 存入道具区（正面朝上，公开；使用时再结算）
 * - 未注册 → 占位 log（issue 06 降级约定）
 */
function handlePurchase(state: GameState, p: PlayerState, defId: string, subtype: string | undefined, config: GameConfig): void {
  const def = getEffect(`market:${defId}`);
  if (def) {
    def.run(state, { config, playerId: p.id, effectId: def.id });
    return;
  }
  if (subtype === "备用道具") {
    p.zones.items.push(defId);
    log(state, `${p.name} 获得备用道具 ${defId}（存入道具区）`);
    return;
  }
  log(state, `效果未实现: market:${defId}`);
}

/** 创建一局（M2）：发牌、随机决定临时特权证、可选注入卡池（黑市供应堆/简易过滤）与角色（roleSetup），进入第一回合 */
export function createGame(
  playerInfos: { id: string; name: string; characterId?: string }[],
  config: GameConfig,
  seed: number,
  pool?: CardPool,
  opts: { simple?: boolean } = {},
): GameState {
  if (playerInfos.length < 2 || playerInfos.length > 4) {
    throw new Error("MVP 白板局支持 2-4 人");
  }
  const players = playerInfos.map((info, seat) => newPlayer(info.id, info.name, seat));
  const state: GameState = {
    players,
    phase: "draw",
    turn: 1,
    passHolderSeat: null,
    blackMarket: {
      slots: Array.from({ length: config.blackMarketSlots }, () => ({
        defId: null,
        price: 0,
        bonusChips: 0,
      })),
      supply: [],
    },
    eventCardId: null,
    pendingPrompt: null,
    rngState: seed,
    log: [],
    finished: false,
    winners: [],
  };

  // 卡池注入：黑市供应堆（按 count 展开；简易模式仅黄边）→ 填满栏位
  if (pool) {
    const marketDefs = opts.simple ? pool.market.filter((d) => d.yellowBorder) : pool.market;
    state.blackMarket.supply = shuffle(
      state,
      marketDefs.flatMap((d) =>
        Array.from({ length: d.count }, () => ({ defId: d.id, price: d.price ?? 0, subtype: d.subtype })),
      ),
    );
    for (const slot of state.blackMarket.slots) {
      const next = state.blackMarket.supply.shift();
      if (next) {
        slot.defId = next.defId;
        slot.price = next.price;
        slot.subtype = next.subtype;
      }
    }
  }

  // 角色注入：设置 characterId 并应用游戏开始 setup（roleSetup）
  for (let i = 0; i < players.length; i++) {
    const info = playerInfos[i]!;
    const p = players[i]!;
    if (info.characterId) {
      p.characterId = info.characterId;
      roleSetup[info.characterId]?.(state, { config, playerId: p.id, effectId: `setup:${info.characterId}` });
    }
  }

  // 每人一副 54 张洗混
  for (const p of state.players) {
    p.zones.draw = shuffle(state, buildDeck(p.seat));
  }
  // 临时特权证：各抽 1 张比点数（骨架用抽牌堆顶代替"挪威比较"），平手取先座
  // 未随公例的 M2 细节：持证者 2 血筹、其余 3 血筹（规则 4.4）
  let bestSeat = 0;
  let bestRank = -1;
  for (const p of state.players) {
    const c = p.zones.draw.shift()!;
    p.zones.discard.push(c);
    if ((c.rank ?? 0) > bestRank) {
      bestRank = c.rank ?? 0;
      bestSeat = p.seat;
    }
  }
  state.passHolderSeat = bestSeat;
  for (const p of state.players) {
    p.chips = p.seat === bestSeat ? config.initialSwapTokens.passHolder : config.initialSwapTokens.others;
  }
  log(state, `${state.players[bestSeat]!.name} 获得临时特权证`);
  log(state, "—— 第 1 回合 ——");
  enterPhase(state, "draw", config);
  return state;
}

/** 处理 resolvePrompt：校验选择 → 调效果 resolve → 清挂起 */
function resolvePrompt(state: GameState, action: Extract<Action, { type: "resolvePrompt" }>, config: GameConfig): void {
  const prompt = state.pendingPrompt;
  if (!prompt) throw new Error("当前没有待决交互");
  if (prompt.playerId !== action.playerId) throw new Error("等待其他玩家选择");
  const def = getEffect(prompt.effectId);
  if (!def?.resolve) throw new Error(`效果 ${prompt.effectId} 无 resolve 实现`);
  validateChoice(prompt, action.choice);
  def.resolve(state, { config, playerId: prompt.playerId, effectId: prompt.effectId }, action.choice);
  log(state, `${state.players.find((p) => p.id === prompt.playerId)?.name ?? prompt.playerId} 完成交互选择`);
  // 链式挂起：resolve 内可以再挂一个新交互（如"是否发动"→"选哪张牌"），此时不清空、也不恢复阶段推进
  const chained = state.pendingPrompt !== prompt;
  if (!chained) state.pendingPrompt = null;
  if (!chained) resumePhase(state, config);
}

/** 纯函数 reducer：输入当前 state 与 Action，返回全新 state */
export function reduce(state: GameState, action: Action, config: GameConfig): GameState {
  if (state.finished) throw new Error("游戏已结束");
  const next: GameState = structuredClone(state);
  const p = findPlayer(next, action.playerId);

  // 交互挂起门禁：pendingPrompt 非空时只接受目标玩家的 resolvePrompt
  if (next.pendingPrompt) {
    if (action.type !== "resolvePrompt") throw new Error("有待决交互，请先完成选择");
    resolvePrompt(next, action, config);
    return next;
  }

  const seatIdx = p.seat;

  switch (action.type) {
    case "swap": {
      if (next.phase !== "swap") throw new Error("当前不在换牌阶段");
      if (p.phaseReady) throw new Error("已停止换牌");
      // 偶像（role:14）可弃任意数量；其余至多 3 张
      const maxDiscard = p.swapPolicy === "anyCount" ? p.zones.hand.length : Math.min(3, p.swapLeft);
      if (action.discardIds.length > maxDiscard) throw new Error("换牌张数超限");
      const ids = new Set(action.discardIds);
      const moving = p.zones.hand.filter((c) => ids.has(c.id));
      if (moving.length !== action.discardIds.length) throw new Error("手牌中找不到待弃的牌");
      p.zones.hand = p.zones.hand.filter((c) => !ids.has(c.id));
      p.zones.discard.push(...moving);
      // 特级大厨（role:15）：每弃置 1 张 3 得 1 血筹
      const threes = moving.filter((c) => c.rank === 3).length;
      if (threes > 0 && p.characterId === "role:15" && !p.skillDisabled) {
        p.chips += threes;
        log(next, `${p.name} 弃置 ${threes} 张 3，获得 ${threes} 血筹`);
      }
      // 偶像（role:14）：一次弃 4 张及以上得 1 血筹
      if (moving.length >= 4 && p.characterId === "role:14" && !p.skillDisabled) {
        p.chips += 1;
        log(next, `${p.name} 一次弃置 ${moving.length} 张，获得 1 血筹`);
      }
      drawToHandLimit(next, p, config);
      p.swapLeft -= 1;
      if (p.swapLeft === 0) {
        p.phaseReady = true;
        runActionHook(next, p.characterId, "swapZero", config, p.id); // 酒保：剩余换牌次数归 0 得 1 血筹
      }
      break;
    }
    case "swapDrawFirst": {
      // 塔罗师（role:10）【换牌阶段】先抽再弃，每次最多抽 2 张再弃 2 张
      if (next.phase !== "swap") throw new Error("当前不在换牌阶段");
      if (p.phaseReady) throw new Error("已停止换牌");
      if (p.swapPolicy !== "drawFirst" || p.skillDisabled) throw new Error("该角色不支持先抽后弃");
      if (action.discardIds.length > 2) throw new Error("先抽后弃每次最多弃 2 张");
      drawCards(next, p, config, 2);
      const ids = new Set(action.discardIds);
      const moving = p.zones.hand.filter((c) => ids.has(c.id));
      if (moving.length !== action.discardIds.length) throw new Error("手牌中找不到待弃的牌");
      p.zones.hand = p.zones.hand.filter((c) => !ids.has(c.id));
      p.zones.discard.push(...moving);
      p.swapLeft -= 1;
      if (p.swapLeft === 0) {
        p.phaseReady = true;
        runActionHook(next, p.characterId, "swapZero", config, p.id);
      }
      break;
    }
    case "buyDraw": {
      // 炸鸡店老板（role:12）【换牌阶段】花 1 血筹抽 1 张（无次数限制，不消耗换牌次数）
      if (next.phase !== "swap") throw new Error("当前不在换牌阶段");
      if (p.phaseReady) throw new Error("已停止换牌");
      if (p.characterId !== "role:12" || p.skillDisabled) throw new Error("该角色不支持付费抽牌");
      if (p.chips < 1) throw new Error("血筹不足");
      p.chips -= 1;
      drawCards(next, p, config, 1);
      log(next, `${p.name} 花 1 血筹抽 1 张牌`);
      break;
    }
    case "stopSwap": {
      if (next.phase !== "swap") throw new Error("当前不在换牌阶段");
      p.chips += p.swapLeft; // 未用次数 1 次 = 1 血筹
      log(next, `${p.name} 停止换牌，剩余 ${p.swapLeft} 次兑换为血筹`);
      p.swapLeft = 0;
      p.phaseReady = true;
      if (allReady(next)) leavePhase(next, config, "play");
      break;
    }
    case "playCards": {
      if (next.phase !== "play") throw new Error("当前不在出牌阶段");
      if (p.phaseReady) throw new Error("已出牌");
      const ids = new Set(action.cardIds);
      const moving = p.zones.hand.filter((c) => ids.has(c.id));
      const minPlay = Math.min(5, config.handLimit);
      if (moving.length !== action.cardIds.length) throw new Error("手牌中找不到待出的牌");
      if (moving.length < minPlay && p.zones.hand.length >= minPlay) {
        throw new Error(`必须出 ${minPlay} 张`);
      }
      if (moving.length === 0) throw new Error("出牌区不能为空");
      p.zones.hand = p.zones.hand.filter((c) => !ids.has(c.id));
      p.zones.discard.push(...p.zones.hand.splice(0)); // 其余手牌弃置
      p.zones.play = moving;
      p.phaseReady = true;
      if (allReady(next)) leavePhase(next, config, "duel");
      break;
    }
    case "purchase": {
      if (next.phase !== "purchase") throw new Error("当前不在购买阶段");
      if (p.purchaseFlipped) throw new Error("已翻面，不可购买");
      const slot = next.blackMarket.slots[action.slotIndex];
      if (!slot?.defId) throw new Error("该栏位无黑市牌");
      const price = characterPurchasePrice(p, slot.price); // 吉祥物：本回合首次购买半价
      if (p.chips < price) throw new Error("血筹不足");
      p.chips -= price;
      p.chips += slot.bonusChips;
      p.purchasedThisTurn = true;
      log(next, `${p.name} 购买 ${slot.defId}（${price}筹${price !== slot.price ? `，原价 ${slot.price}` : ""}${slot.bonusChips > 0 ? `，含叠加 ${slot.bonusChips} 筹` : ""}）`);
      const defId = slot.defId;
      const subtype = slot.subtype;
      handlePurchase(next, p, defId, subtype, config);
      refillSlot(next, action.slotIndex);
      break;
    }
    case "skipPurchase": {
      if (next.phase !== "purchase") throw new Error("当前不在购买阶段");
      p.purchaseFlipped = true;
      p.phaseReady = true;
      if (allReady(next)) endPurchasePhase(next, config);
      break;
    }
    case "deleteCards": {
      if (next.phase !== "delete") throw new Error("当前不在删牌阶段");
      const ids = new Set(action.cardIds);
      const moving = p.zones.discard.filter((c) => ids.has(c.id));
      const freeQuota = config.deleteFreePerRound + (p.freeDeleteExtra ?? 0); // 黑客额外免费额度
      const extra = Math.max(0, moving.length - freeQuota);
      const cost = extra * config.deleteChipCost;
      if (p.chips < cost) throw new Error(`血筹不足，需 ${cost} 筹`);
      if (moving.length !== action.cardIds.length) throw new Error("弃牌区中找不到待删的牌");
      p.chips -= cost;
      p.zones.discard = p.zones.discard.filter((c) => !ids.has(c.id));
      p.zones.deleted.push(...moving);
      log(next, `${p.name} 删除 ${moving.length} 张牌${cost > 0 ? `（付 ${cost} 筹）` : "（免费）"}`);
      // 特级大厨等"任意时候删除"类奖励（与原语删除路径共用同一入口）
      afterCardsDeleted(next, { config, playerId: p.id, effectId: "action:deleteCards" }, moving);
      break;
    }
    case "ready": {
      if (next.phase !== "delete") throw new Error("该阶段无需就绪确认");
      p.phaseReady = true;
      if (allReady(next)) leavePhase(next, config, "reshape");
      break;
    }
    case "reshape": {
      if (next.phase !== "reshape") throw new Error("当前不在重整阶段");
      if (action.reshuffle) {
        p.zones.draw = shuffle(next, [...p.zones.draw, ...p.zones.discard.splice(0)]);
        log(next, `${p.name} 重洗牌库`);
        runActionHook(next, p.characterId, "reshuffle", config, p.id); // 洗衣房店主：重洗得 1 血筹
      } else {
        p.chips += config.reshuffleOrChips;
        log(next, `${p.name} 不重洗，+${config.reshuffleOrChips} 血筹`);
        runActionHook(next, p.characterId, "noReshuffle", config, p.id); // 洗衣房店主：额外 2 血筹
      }
      p.phaseReady = true;
      if (allReady(next)) endTurn(next, config);
      break;
    }
    case "resolvePrompt": {
      // 理论不可达：挂起门禁已在 reduce 入口处理；防御性拒绝
      throw new Error("当前没有待决交互");
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`未知 Action: ${JSON.stringify(exhaustive)}`);
    }
  }
  void seatIdx;
  return next;
}
