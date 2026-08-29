/**
 * 票据 02 — 白板局（无角色技能/无黑市效果）骨架 reducer。
 *
 * 职责边界：跑通 8 阶段全流程的状态机形状与推进规则，
 * 宣告交互（JOKER 逐项赋值）、角色/黑市效果、初始构筑均留给 M2+，
 * 本骨架的对决结算直接用 hand-evaluator 的自动最优 JOKER 求解。
 *
 * 模型：reduce(state, action, config) → 新 state（纯函数，入参不改）。
 * Action 流 + 初始 rngState 即可完整重放一局。
 */
import type { Card } from "../cards.js";
import { card, joker, SUITS } from "../cards.js";
import type { GameConfig } from "../core/config.js";
import type { GameState, PlayerState, PhaseId } from "../core/state.js";
import { PHASE_ORDER } from "../core/state.js";
import { nextInt, shuffle } from "../core/rng.js";
import { evaluateHand, compareHands } from "../hand-evaluator.js";
import { resolveTiming, runTimingQueue } from "../core/effects.js";

export type Action =
  | { type: "swap"; playerId: string; discardIds: string[] }
  | { type: "stopSwap"; playerId: string }
  | { type: "playCards"; playerId: string; cardIds: string[] }
  | { type: "purchase"; playerId: string; slotIndex: number }
  | { type: "skipPurchase"; playerId: string }
  | { type: "deleteCards"; playerId: string; cardIds: string[] }
  | { type: "ready"; playerId: string }
  | { type: "reshape"; playerId: string; reshuffle: boolean };

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

/** 抽牌至手牌上限；抽牌堆不足时先重洗弃牌堆 */
function drawToHandLimit(state: GameState, p: PlayerState, config: GameConfig): void {
  while (p.zones.hand.length < config.handLimit) {
    if (p.zones.draw.length === 0) {
      if (p.zones.discard.length === 0) return; // 无牌可抽（牌打空的现实边界）
      p.zones.draw = shuffle(state, p.zones.discard.splice(0));
      log(state, `${p.name} 重洗弃牌堆组成新抽牌堆`);
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

function enterPhase(state: GameState, phase: PhaseId, config: GameConfig): void {
  state.phase = phase;
  for (const p of state.players) {
    p.phaseReady = false;
    if (phase === "swap") {
      p.swapLeft = p.seat === state.passHolderSeat ? config.swapCountWithPass : config.swapCount;
    }
    if (phase === "purchase") p.purchaseFlipped = false;
  }

  if (phase === "draw") {
    runHooks(state, "before", config);
    for (const p of state.players) drawToHandLimit(state, p, config);
    runHooks(state, "after", config);
    enterPhase(state, "swap", config); // 抽牌无玩家交互，直接推进
    return;
  }
  if (phase === "duel") {
    runHooks(state, "before", config);
    resolveDuel(state, config);
    runHooks(state, "after", config);
    enterPhase(state, "settle", config);
    return;
  }
  if (phase === "settle") {
    runHooks(state, "before", config);
    checkVictory(state, config);
    runHooks(state, "after", config);
    if (!state.finished) enterPhase(state, "purchase", config);
    return;
  }
  // swap / play / purchase / delete / reshape：等待玩家 Action
}

/** 对决自动结算（骨架：无宣告交互，直接取最优牌型） */
function resolveDuel(state: GameState, config: GameConfig): void {
  const evaluated = state.players.map((p) => ({
    p,
    ev: p.zones.play.length > 0 ? evaluateHand(p.zones.play) : null,
  }));
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

  evaluated.forEach(({ p }, idx) => {
    const rank = idx + 1;
    const reward = config.rankRewards[String(n)]?.find((r) => r.rank === rank);
    if (reward) {
      p.tickets += reward.tickets;
      p.chips += reward.chips;
      log(state, `${p.name} 第${rank}名：+${reward.tickets}票 +${reward.chips}筹`);
    }
    if (rank === 1) {
      state.passHolderSeat = p.seat;
      log(state, `${p.name} 夺魁，获得临时特权证`);
    }
    p.zones.discard.push(...p.zones.play.splice(0)); // 出牌区置入弃牌区
  });
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

function endPurchasePhase(state: GameState, config: GameConfig): void {
  runHooks(state, "after", config);
  // 购买阶段结束：最右两格叠加血筹
  for (const slotNo of config.blackMarketBonusSlots) {
    const slot = state.blackMarket.slots[slotNo - 1];
    if (slot && slot.defId) {
      slot.bonusChips += config.blackMarketBonusChips;
    }
  }
  enterPhase(state, "delete", config);
}

function endTurn(state: GameState, config: GameConfig): void {
  runHooks(state, "after", config);
  state.turn += 1;
  log(state, `—— 第 ${state.turn} 回合 ——`);
  enterPhase(state, "draw", config);
}

function refillSlot(state: GameState, slotIndex: number): void {
  const next = state.blackMarket.supply.shift();
  const slot = state.blackMarket.slots[slotIndex];
  if (!slot) return;
  if (next) {
    slot.defId = next.defId;
    slot.price = next.price;
    slot.bonusChips = 0;
  } else {
    slot.defId = null; // 黑市买空不补齐（规则 6）
  }
}

/** 创建一局（白板骨架）：发牌、随机决定临时特权证、直接进入第一回合抽牌阶段 */
export function createGame(
  playerInfos: { id: string; name: string }[],
  config: GameConfig,
  seed: number,
): GameState {
  if (playerInfos.length < 2 || playerInfos.length > 4) {
    throw new Error("MVP 白板局支持 2-4 人");
  }
  const state: GameState = {
    players: playerInfos.map((info, seat) => newPlayer(info.id, info.name, seat)),
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
    rngState: seed,
    log: [],
    finished: false,
    winners: [],
  };

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

/** 纯函数 reducer：输入当前 state 与 Action，返回全新 state */
export function reduce(state: GameState, action: Action, config: GameConfig): GameState {
  if (state.finished) throw new Error("游戏已结束");
  const next: GameState = structuredClone(state);
  const p = findPlayer(next, action.playerId);
  const seatIdx = p.seat;

  switch (action.type) {
    case "swap": {
      if (next.phase !== "swap") throw new Error("当前不在换牌阶段");
      if (p.phaseReady) throw new Error("已停止换牌");
      if (action.discardIds.length > Math.min(3, p.swapLeft)) throw new Error("换牌张数超限");
      const ids = new Set(action.discardIds);
      const moving = p.zones.hand.filter((c) => ids.has(c.id));
      if (moving.length !== action.discardIds.length) throw new Error("手牌中找不到待弃的牌");
      p.zones.hand = p.zones.hand.filter((c) => !ids.has(c.id));
      p.zones.discard.push(...moving);
      drawToHandLimit(next, p, config);
      p.swapLeft -= 1;
      if (p.swapLeft === 0) p.phaseReady = true;
      break;
    }
    case "stopSwap": {
      if (next.phase !== "swap") throw new Error("当前不在换牌阶段");
      p.chips += p.swapLeft; // 未用次数 1 次 = 1 血筹
      log(next, `${p.name} 停止换牌，剩余 ${p.swapLeft} 次兑换为血筹`);
      p.swapLeft = 0;
      p.phaseReady = true;
      if (allReady(next)) {
        runHooks(next, "after", config);
        enterPhase(next, "play", config);
      }
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
      if (allReady(next)) {
        runHooks(next, "after", config);
        enterPhase(next, "duel", config);
      }
      break;
    }
    case "purchase": {
      if (next.phase !== "purchase") throw new Error("当前不在购买阶段");
      if (p.purchaseFlipped) throw new Error("已翻面，不可购买");
      const slot = next.blackMarket.slots[action.slotIndex];
      if (!slot?.defId) throw new Error("该栏位无黑市牌");
      if (p.chips < slot.price) throw new Error("血筹不足");
      p.chips -= slot.price;
      p.chips += slot.bonusChips;
      log(next, `${p.name} 购买 ${slot.defId}（${slot.price}筹，效果结算留 M2）`);
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
      const extra = Math.max(0, moving.length - config.deleteFreePerRound);
      const cost = extra * config.deleteChipCost;
      if (p.chips < cost) throw new Error(`血筹不足，需 ${cost} 筹`);
      if (moving.length !== action.cardIds.length) throw new Error("弃牌区中找不到待删的牌");
      p.chips -= cost;
      p.zones.discard = p.zones.discard.filter((c) => !ids.has(c.id));
      p.zones.deleted.push(...moving);
      log(next, `${p.name} 删除 ${moving.length} 张牌${cost > 0 ? `（付 ${cost} 筹）` : "（免费）"}`);
      break;
    }
    case "ready": {
      if (next.phase !== "delete") throw new Error("该阶段无需就绪确认");
      p.phaseReady = true;
      if (allReady(next)) {
        runHooks(next, "after", config);
        enterPhase(next, "reshape", config);
      }
      break;
    }
    case "reshape": {
      if (next.phase !== "reshape") throw new Error("当前不在重整阶段");
      if (action.reshuffle) {
        p.zones.draw = shuffle(next, [...p.zones.draw, ...p.zones.discard.splice(0)]);
        log(next, `${p.name} 重洗牌库`);
      } else {
        p.chips += config.reshuffleOrChips;
        log(next, `${p.name} 不重洗，+${config.reshuffleOrChips} 血筹`);
      }
      p.phaseReady = true;
      if (allReady(next)) endTurn(next, config);
      break;
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`未知 Action: ${JSON.stringify(exhaustive)}`);
    }
  }
  void seatIdx;
  return next;
}
