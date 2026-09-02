/**
 * 黑市牌效果注册（票据 12，M2.3）。
 *
 * 每个黑市牌一个 EffectDef，id = "market:<defId>"，source = "blackMarket"；
 * 购买结算走 handlePurchase（whiteboard 按注册表分发：秘密交易 run 立即结算，强化芯片 run 挂起选牌 + resolve 插入并应用，
 * 备用道具 run 存 items——whiteboard 按 "备用道具" 识别而 JSON subtype 为 "道具"，故统一注册 run 存道具区）。
 *
 * 强化芯片（金科玉律 3/4/7）：
 * - 每牌限 1 芯片不可替换；插入后点数 2-14 校验；无合法目标则弃置该黑市牌（费用不退）。
 * - 数值类（校准器/限流阀）在 resolve 用 addPermanentRank(cardId, delta)（含 2-14 校验）；
 * - 花色/牌型类（变色墨水/双生镜片/百变影像等）是对决时生效的声明效果：插入（chipInstall）已实现，
 *   生效逻辑依赖 hand-evaluator 支持芯片视图，本轮以 TODO 注释占位（不改 hand-evaluator）。
 * - 血幕镀层（出/夺）为简单声明类：以 (duel, during) EffectDef 注册，run 对芯片持有者实际生效。
 *
 * 阶段时机效果：triggerText 含【对决】【结算】的牌，注册对应 (phase, timing) 的 EffectDef（可复用同一 run 工厂）。
 *
 * 规则来源：docs/血色牌局_规则书.md（§5.6 黑市牌处理、金科玉律 3/4/7/10）+ config/cards/market.json 的 effectText。
 * 实现约束：只组合 primitives/interactive 原语，同模式卡用工厂复用；缺原语在本地组合；
 * 未实现的效果注册 TODO 占位 run（保留购买结算链路，不挂起不报错）。
 */
import type { GameState, PlayerState, PhaseId } from "../core/state.js";
import { shuffle } from "../core/rng.js";
import type { EffectDef, EffectContext } from "../core/effects.js";
import { registerEffect, getEffect } from "../core/effects.js";
import {
  addPermanentRank,
  deleteCards,
  deleteFromDiscard,
  findPlayer,
  gainChips,
  getPlayer,
  logText,
  removeChip,
  rollDice,
  spendChips,
} from "./primitives.js";
import { promptChooseCard, promptChoosePlayer } from "./interactive.js";
import { SUITS, type Suit } from "../cards.js";
import { type ChipView, HandCategory } from "../hand-evaluator.js";

/** 数字滑轨：点数可视为 2-14 任意值（含原值，求解器取最优） */
const ALL_RANKS = Array.from({ length: 13 }, (_, i) => i + 2);

/**
 * 由玩家已插入的强化芯片构建判定视图（票据 20）。
 * 声明类芯片只是"可视为"，故一律给候选集而非定值，由求解器取最优：
 * - 008 变色墨水 花色任意 / 009 黑色芯片 ♠♣ / 010 红色芯片 ♦♥ / 011 数字滑轨点数任意
 * - 012 百变影像 花色点数任意（等价 JOKER）/ 017 双生镜片 视为 2 张（复制品）
/**
 * 芯片 ID → 是否为声明类（需玩家在出牌时声明具体值）。
 * 变色墨水(008)/黑色芯片(009)/红色芯片(010)/数字滑轨(011)/百变影像(012)。
 */
export const DECLARE_TYPE_CHIPS = new Set(["008", "009", "010", "011", "012"]);

/**
 * 从声明值字符串解析花色（008/009/010 有效）。
 * 格式：直接是花色字母如 "S"、"H"、"D"、"C"，或 "any" 表示任意。
 */
function parseDeclaredSuit(val: string): Suit[] | null {
  if (val === "any") return [...SUITS];
  if (SUITS.includes(val as "S")) return [val as "S"];
  return null;
}

/**
 * 从声明值字符串解析点数（011 有效）。
 * 格式："rank:N" 表示具体点数，"any" 表示任意 2-14。
 */
function parseDeclaredRank(val: string): number[] | null {
  if (val === "any") return [...ALL_RANKS];
  const m = val.match(/^rank:(\d+)$/);
  if (m) {
    const r = parseInt(m[1]!, 10);
    return ALL_RANKS.includes(r) ? [r] : null;
  }
  return null;
}

/**
 * 芯片失效（全局 chipsDisabled 或单张 disabledChipCards）时不进视图。
 * declarations：玩家在出牌阶段提交的声明值（票据 22）。
 * - 有声明时，用声明值替换全开候选（变色墨水"任意"→玩家选的花色；数字滑轨"任意"→玩家选的点数）
 * - 百变影像(012)声明格式为 "suit:S,rank:7" 或 "any"（表示任意花色+点数，等价于 asJoker）
 */
export function chipViewFromChips(
  p: PlayerState,
  declarations?: Record<string, string>,
): ChipView | undefined {
  if (p.chipsDisabled) return undefined;
  const dead = new Set(p.disabledChipCards ?? []);
  const view: ChipView = {};
  for (const [cardId, defId] of Object.entries(p.zones.chips)) {
    if (dead.has(cardId)) continue;
    const declared = declarations?.[cardId];
    switch (defId) {
      case "008": {
        const opts: Suit[] = declared ? (parseDeclaredSuit(declared) ?? [...SUITS]) : [...SUITS];
        (view.suitOptions ??= {})[cardId] = opts;
        break;
      }
      case "009": {
        const opts: Suit[] = declared
          ? (parseDeclaredSuit(declared) ?? (["S", "C"] as Suit[]))
          : (["S", "C"] as Suit[]);
        (view.suitOptions ??= {})[cardId] = opts;
        break;
      }
      case "010": {
        const opts: Suit[] = declared
          ? (parseDeclaredSuit(declared) ?? (["D", "H"] as Suit[]))
          : (["D", "H"] as Suit[]);
        (view.suitOptions ??= {})[cardId] = opts;
        break;
      }
      case "011": {
        const opts = declared ? parseDeclaredRank(declared) : [...ALL_RANKS];
        if (opts) (view.rankOptions ??= {})[cardId] = opts;
        break;
      }
      case "012": {
        // 百变影像：声明 "any" 或同时含 suit 和 rank
        if (!declared || declared === "any") {
          (view.asJoker ??= []).push(cardId);
        } else {
          // 格式 "suit:S,rank:7" → 固定花色+点数（降级为 declare suit+rank）
          const suitMatch = declared.match(/suit:([SHDC])/);
          const rankMatch = declared.match(/rank:(\d+)/);
          if (suitMatch && rankMatch) {
            const r = parseInt(rankMatch[1]!, 10);
            if (ALL_RANKS.includes(r)) {
              (view.suitOptions ??= {})[cardId] = [suitMatch[1] as "S"];
              (view.rankOptions ??= {})[cardId] = [r];
            } else {
              (view.asJoker ??= []).push(cardId);
            }
          } else {
            (view.asJoker ??= []).push(cardId);
          }
        }
        break;
      }
      case "017":
        (view.duplicate ??= []).push(cardId);
        break;
      default:
        break;
    }
  }
  return Object.keys(view).length > 0 ? view : undefined;
}

/**
 * 强化芯片插入（购买结算）。
 * - run：列出弃牌堆合法候选（未挂芯片、非 JOKER、点数增量后仍在 2-14）并挂起选牌；无候选则弃置该黑市牌；
 * - resolve：把芯片挂到所选牌上（zones.chips[cardId] = defId），数值类同步 addPermanentRank。
 * delta=0 表示声明类芯片（不改点数，只挂载）；noJoker 默认 true：JOKER 无花色/点数，数值类不可插，
 * 声明类对其亦无意义（对决阶段 JOKER 本就任意花色点数），故一律排除。
 */
function chipInstall({
  defId,
  delta = 0,
  noJoker = true,
  promptText,
}: {
  defId: string;
  delta?: number;
  noJoker?: boolean;
  promptText?: string;
}): EffectDef {
  return {
    id: `market:${defId}`,
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      const candidates = p.zones.discard
        .filter((c) => {
          if (c.id in p.zones.chips) return false; // 金科玉律 3：每牌限 1 芯片
          if (c.isJoker) return !noJoker; // JOKER 无点数/花色，默认不可插
          if (delta !== 0) {
            const next = (c.rank ?? 0) + delta;
            return next >= 2 && next <= 14; // 金科玉律 4：点数范围 2-14
          }
          return true;
        })
        .map((c) => c.id);
      if (candidates.length === 0) {
        logText(state, `${ctx.effectId} 无合法插入目标，该黑市牌弃置（费用不退）`);
        return;
      }
      promptChooseCard(state, ctx.effectId, ctx.playerId!, candidates, "discard", promptText ?? "选择插入芯片的牌");
    },
    resolve: (state, ctx, choice) => {
      const cardId = Array.isArray(choice) ? choice[0]! : choice;
      if (!cardId) {
        // 空选择 = 跳过不装芯片（票据 28：026/032/033 等"可跳过"效果的空数组语义；
        // 玩家手动空选直接走这里，区别于 server 超时 autoResolve 的"兜底改选首候选"）
        logText(state, `${ctx.effectId} 未选择插入目标，跳过装芯片（费用不退）`);
        return;
      }
      const p = getPlayer(state, ctx);
      p.zones.chips[cardId] = defId;
      logText(state, `${p.name} 将强化芯片 ${defId} 插入 ${cardId}`);
      if (delta !== 0) addPermanentRank(cardId, delta)(state, ctx);
    },
  };
}

/** 找持有某芯片的所有玩家（阶段时机效果按持有者生效，不依赖 ctx.playerId——resolveTiming 对 blackMarket 源以 players[0] 触发） */
function chipHolders(state: GameState, chipDefId: string): PlayerState[] {
  return state.players.filter((p) => Object.values(p.zones.chips).includes(chipDefId));
}

/**
 * 备用道具效果工厂（规则 5.6：使用时触发，使用后背面朝上弃入黑市回收站）。
 * 同时注册两个效果 ID：
 * - market:defId → handlePurchase 调用（test helper 直接设 slot.defId，走 getEffect("market:defId")）
 * - item:defId  → useItem reducer 调用（走 getEffect("item:defId")）
 */
function itemEffect(
  defId: string,
  run: (state: GameState, ctx: EffectContext) => void,
  resolve?: (state: GameState, ctx: EffectContext, choice: string | string[]) => void,
): EffectDef {
  const purchaseRun: EffectBody = (s, ctx) => {
    const p = getPlayer(s, ctx);
    p.zones.items.push(defId);
    logText(s, `${p.name} 获得备用道具 ${defId}（存入道具区）`);
  };
  // 注册 market:defId（购买结算）
  registerEffect({
    id: `market:${defId}`,
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: purchaseRun,
  });
  // 注册 item:defId（使用效果）
  return {
    id: `item:${defId}`,
    source: "blackMarket",
    phase: "reshape",
    timing: "after",
    run,
    resolve,
  };
}

/**
 * 特权证条件类效果的工厂（票据 20）。
 * mode="self" 用于秘密交易（购买即结算，如 037 特权分红）；
 * mode="chip" 用于强化芯片（结算阶段对芯片持有者结算，如 018/019/020 血幕镀层）。
 * 判定：玩家 seat === state.passHolderSeat；negate=true 则取反（"若不持有"，如 020 血幕镀层·败）。
 */
function passHolderBonus(
  id: string,
  reward: { chips?: number; tickets?: number },
  mode: "self" | "chip",
  opts: { chipDefId?: string; negate?: boolean } = {},
): EffectDef {
  return {
    id,
    source: "blackMarket",
    phase: mode === "self" ? "purchase" : "settle",
    timing: mode === "self" ? "during" : "after",
    run: (state, ctx) => {
      const targets =
        mode === "self"
          ? [getPlayer(state, ctx)]
          : state.players.filter((p) => Object.values(p.zones.chips).includes(opts.chipDefId!));
      for (const p of targets) {
        const isHolder = p.seat === state.passHolderSeat;
        if (isHolder === Boolean(opts.negate)) continue; // negate 时要求"不持有"
        if (reward.chips) gainChips(reward.chips)(state, { ...ctx, playerId: p.id });
        if (reward.tickets) {
          p.tickets += reward.tickets;
          p.ticketsGainedThisTurn = (p.ticketsGainedThisTurn ?? 0) + reward.tickets;
          logText(state, `${p.name} 获得 ${reward.tickets} 车票`);
        }
      }
    },
  };
}

/** 037 类：购买即结算的"若持有特权证"秘密交易 */
function passHolderSelfBonus(defId: string, reward: { chips?: number; tickets?: number }): EffectDef {
  return passHolderBonus(`market:${defId}`, reward, "self");
}

/**
 * 单目标"施加负面状态"类秘密交易的工厂（票据 20）。
 * 挂起选人（默认不含自己）→ resolve 把状态写到目标玩家上。
 * 状态字段（skipPhases / nextTurnSwapDelta / nextTurnSkillDisabled）由 whiteboard 在进入对应阶段时消费。
 */
function targetDebuff(
  defId: string,
  promptText: string,
  apply: (state: GameState, target: PlayerState) => void,
  opts: { includeSelf?: boolean } = {},
): EffectDef {
  return {
    id: `market:${defId}`,
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const me = getPlayer(state, ctx);
      const candidates = state.players.filter((p) => opts.includeSelf || p.id !== me.id).map((p) => p.id);
      if (candidates.length === 0) return;
      promptChoosePlayer(state, `market:${defId}`, ctx.playerId!, candidates, promptText);
    },
    resolve: (state, _ctx, choice) => {
      const targetId = Array.isArray(choice) ? choice[0]! : choice;
      apply(state, findPlayer(state, targetId));
    },
  };
}

/**
 * 026 共享信息：自己删至多 2 张 → 逐位对手各删至多 1 张（链式跨玩家挂起）。
 * 对手只能看自己的弃牌堆（金科玉律 2），故必须由对手本人响应，carry 传递剩余对手队列。
 */
function sharedInfo(): EffectDef {
  const nextOpponent = (state: GameState, queue: string[]): void => {
    if (queue.length === 0) return;
    const [head, ...rest] = queue;
    const target = findPlayer(state, head!);
    if (target.zones.discard.length === 0) {
      logText(state, `${target.name} 弃牌堆为空，跳过`);
      return nextOpponent(state, rest);
    }
    promptChooseCard(
      state,
      "market:026",
      head!,
      target.zones.discard.map((c) => c.id),
      "discard",
      `共享信息：可删除 1 张牌（不选即放弃）`,
      queue.join(","),
    );
  };
  return {
    id: "market:026",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const me = getPlayer(state, ctx);
      const opponents = state.players.filter((p) => p.id !== me.id).map((p) => p.id);
      if (me.zones.discard.length === 0 && opponents.length === 0) return;
      if (me.zones.discard.length === 0) return nextOpponent(state, opponents);
      promptChooseCard(
        state,
        "market:026",
        me.id,
        me.zones.discard.map((c) => c.id),
        "discard",
        "共享信息：可删除至多 2 张牌（不选即放弃）",
        `self|${opponents.join(",")}`,
      );
    },
    resolve: (state, ctx, choice) => {
      const isSelfStage = (ctx.carry ?? "").startsWith("self|");
      const ids = (Array.isArray(choice) ? choice : []).slice(0, isSelfStage ? 2 : 1);
      const responder = findPlayer(state, ctx.playerId!);
      for (const id of ids) deleteFromDiscard(id, responder.id)(state, ctx);
      // carry 形如 "self|b,c"（自己阶段）或 "b,c"（对手队列，队首即当前响应者）
      const queue = (ctx.carry ?? "").replace(/^self\|/, "").split(",").filter(Boolean);
      const rest = queue.filter((id) => id !== ctx.playerId);
      nextOpponent(state, rest);
    },
  };
}

/**
 * 032 精准删除：抽 3 张，删除其中 0-2 张，弃置剩余。
 * 抽出的 3 张暂入手牌（私密区域，UI 可直接展示），resolve 后剩余弃置。
 */
function preciseDelete(): EffectDef {
  return {
    id: "market:032",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      const drawn: string[] = [];
      for (let i = 0; i < 3; i++) {
        if (p.zones.draw.length === 0) {
          if (p.zones.discard.length === 0) break;
          p.zones.draw = shuffle(state, p.zones.discard.splice(0));
          logText(state, `${p.name} 重洗弃牌堆组成新抽牌堆`);
        }
        const c = p.zones.draw.shift()!;
        p.zones.hand.push(c);
        drawn.push(c.id);
      }
      if (drawn.length === 0) {
        logText(state, `${p.name} 无牌可抽，精准删除无事发生`);
        return;
      }
      logText(state, `${p.name} 精准删除：抽出 ${drawn.length} 张待选`);
      promptChooseCard(state, "market:032", p.id, drawn, "hand", "删除其中 0-2 张（不选即全部弃置）", drawn.join(","));
    },
    resolve: (state, ctx, choice) => {
      const p = getPlayer(state, ctx);
      const drawn = new Set((ctx.carry ?? "").split(",").filter(Boolean));
      const picked = new Set(Array.isArray(choice) ? choice.slice(0, 2) : []);
      const mine = p.zones.hand.filter((c) => drawn.has(c.id));
      p.zones.hand = p.zones.hand.filter((c) => !drawn.has(c.id)); // 抽出的 3 张全部离开手牌
      const deleting = mine.filter((c) => picked.has(c.id));
      const discarding = mine.filter((c) => !picked.has(c.id));
      for (const c of deleting) {
        p.zones.deleted.push(c);
        delete p.zones.chips[c.id];
      }
      p.zones.discard.push(...discarding);
      logText(state, `${p.name} 精准删除：删除 ${deleting.length} 张，弃置 ${discarding.length} 张`);
    },
  };
}

/**
 * 033 定点爆破：选一位对手 → 该对手从自己弃牌堆删除 1 张。
 *
 * 规则书为"宣称一个点数，对手删除 1 张该点数的牌"；但金科玉律 2 规定弃牌堆对他人不可见，
 * 购买者无从挑选，故等价落地为：购买者只选对手，由对手本人在自己的弃牌堆里挑 1 张删除
 * （对手不选即放弃）。这既守住私密性，也保留了"被爆破方承担删牌代价"的规则意图。
 */
function pinpointBlast(): EffectDef {
  return {
    id: "market:033",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const me = getPlayer(state, ctx);
      const opponents = state.players.filter((p) => p.id !== me.id);
      if (opponents.length === 0) return;
      promptChoosePlayer(state, "market:033", ctx.playerId!, opponents.map((p) => p.id), "选择一位对手");
    },
    resolve: (state, ctx, choice) => {
      if (typeof choice === "string") {
        // 阶段一：选定对手 → 交给对手本人选牌
        const target = findPlayer(state, choice);
        if (target.zones.discard.length === 0) {
          logText(state, `${target.name} 弃牌堆为空，定点爆破无事发生`);
          return;
        }
        promptChooseCard(
          state,
          "market:033",
          target.id,
          target.zones.discard.map((c) => c.id),
          "discard",
          "定点爆破：从弃牌堆删除 1 张（不选即放弃）",
        );
        return;
      }
      // 阶段二：对手选完，删 1 张
      const cardId = choice[0];
      if (!cardId) {
        logText(state, `${findPlayer(state, ctx.playerId!).name} 放弃删除`);
        return;
      }
      deleteFromDiscard(cardId, ctx.playerId!)(state, ctx);
    },
  };
}

/**
 * 043 再来一批：黑市区选 0-2 张放回黑市牌堆底 → 补齐黑市 → 可立即再购买一次。
 * 候选是栏位序号（"market" 来源），resolve 时先把选中的牌全部压入 supply 尾部，
 * 再统一从 supply 顶部补位（避免刚放回的牌被自己补回原位）；「购买先摘牌」保证
 * 候选里不含刚买走的牌。purchaseFlipped 显式置 false 表达「可再购买」（防将来加限购）。
 */
function restock(): EffectDef {
  return {
    id: "market:043",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const candidates = state.blackMarket.slots
        .map((s, i) => (s.defId ? String(i) : null))
        .filter((x): x is string => x !== null);
      if (candidates.length === 0) {
        logText(state, "market:043 黑市已空，无事发生");
        return;
      }
      promptChooseCard(
        state,
        "market:043",
        ctx.playerId!,
        candidates,
        "market",
        "选择放回牌堆底的牌（至多 2 张，不选即只补位）",
      );
    },
    resolve: (state, ctx, choice) => {
      const p = getPlayer(state, ctx);
      const picked = (Array.isArray(choice) ? choice : []).slice(0, 2).map(Number);
      // 先全部回堆底再统一补位：避免刚放回的牌被自己补回原位
      const emptied: number[] = [];
      for (const i of picked) {
        const slot = state.blackMarket.slots[i];
        if (!slot?.defId) continue;
        state.blackMarket.supply.push({ defId: slot.defId, price: slot.price, subtype: slot.subtype });
        slot.defId = null;
        slot.bonusChips = 0;
        emptied.push(i);
      }
      for (const i of emptied) {
        const next = state.blackMarket.supply.shift();
        const slot = state.blackMarket.slots[i];
        if (!slot) continue;
        if (next) {
          slot.defId = next.defId;
          slot.price = next.price;
          slot.subtype = next.subtype;
        }
      }
      p.purchaseFlipped = false; // 可立即再进行一次购买
      logText(state, `market:043 回堆 ${picked.length} 张并补位，${p.name} 可再购买一次`);
    },
  };
}

/** 闭店礼：获得血筹并跳过本回合购买（purchaseFlipped+phaseReady） */
function closingBonus(defId: string, chips: number): EffectDef {
  return {
    id: `market:${defId}`,
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      gainChips(chips)(state, ctx);
      p.purchaseFlipped = true;
      p.phaseReady = true;
      logText(state, `${p.name} 获得 ${chips} 血筹，跳过本回合购买`);
    },
  };
}

/** 注册黑市牌全部效果（模块加载时执行一次） */
export function registerMarketEffects(): void {
  // ── 强化芯片：数值类（校准器/限流阀，金科玉律 3/4）────────────────────────
  for (const [defId, delta] of [
    ["001", 1],
    ["002", 2],
    ["003", 3],
    ["004", 4],
    ["005", -1],
    ["006", -2],
    ["007", -3],
  ] as const) {
    registerEffect(chipInstall({ defId, delta, promptText: `选择插入芯片（点数 ${delta > 0 ? "+" : ""}${delta}）的牌` }));
  }

  // ── 强化芯片：声明类（插入已实现；对决/结算生效依赖 hand-evaluator 芯片视图，TODO）──
  for (const defId of ["008", "009", "010", "011", "012", "017", "019", "020"]) {
    registerEffect(chipInstall({ defId }));
  }
  // TODO: 008 变色墨水（花色任意）/009 黑色芯片（♠♣）/010 红色芯片（♦♥）/011 数字滑轨（点数任意）/
  // 012 百变影像（花色点数任意）/017 双生镜片（视为 2 张，不可插 JOKER）的对决声明——
  // 已由 chipViewFromChips 在判定阶段消费（见 mergeChipView）。

  // 018/019/020 血幕镀层（车票/胜/败）：结算时按特权证条件对芯片持有者结算（settle 注册见下）。
  // 019/020 的插牌已由上方声明类批量注册覆盖；018 在此单独补注册。
  // chipInstall 默认 noJoker=true，与卡面「不可插入【Joker牌】中」一致。
  registerEffect(chipInstall({ defId: "018" }));
  // 021/022 血幕镀层（出/夺）：简单声明类，对决时实际生效（见下方阶段时机效果）
  registerEffect(chipInstall({ defId: "021" }));
  registerEffect(chipInstall({ defId: "022" }));
  // 025 自毁芯片：结算结束时删除本回合打出的所有牌（含芯片所在牌），见 market:025:settle
  registerEffect(chipInstall({ defId: "025" }));

  // ── 秘密交易：黄边 ────────────────────────────────────────────────
  registerEffect(cheapDelete()); // 027 廉价删除
  registerEffect(violentDelete()); // 031 暴力删除
  registerEffect(freeTopCard()); // 034 货箱盲掏
  registerEffect(diceGain()); // 036 对赌协议
  // 037 特权分红：若持有【临时特权证】，获得 3 血筹（购买立即结算）
  registerEffect(passHolderSelfBonus("037", { chips: 3 }));
  registerEffect(restock()); // 043 再来一批：选牌回堆底 + 补位 + 可再购买

  // ── 秘密交易：非黄边（尽量注册简单/自动类）──────────────────────────────
  registerEffect(closingBonus("028", 4)); // 闭店礼·小
  registerEffect(closingBonus("029", 7)); // 闭店礼·中
  registerEffect(closingBonus("030", 11)); // 闭店礼·大
  registerEffect(passGrab()); // 039 鬼手探囊
  registerEffect(shareChips()); // 041 血筹分享
  registerEffect(pluckChip()); // 042 拔除芯片
  registerEffect(sharedInfo()); // 026 共享信息：自己删 2 + 逐位对手各删 1（链式跨玩家挂起）
  registerEffect(preciseDelete()); // 032 精准删除：抽 3 删 0-2 弃余
  registerEffect(pinpointBlast()); // 033 定点爆破：选对手，对手自弃牌堆删 1
  // 038/040/044：单目标负面状态（状态由 whiteboard 在对应阶段消费）
  registerEffect(
    targetDebuff("038", "选择跳过本回合重整的对手", (state, t) => {
      t.skipPhases = [...new Set([...(t.skipPhases ?? []), "reshape" as PhaseId])];
      logText(state, `${t.name} 本回合跳过重整（冻结车厢）`);
    }),
  );
  registerEffect(
    targetDebuff("040", "选择下回合换牌次数 -2 的对手", (state, t) => {
      t.nextTurnSwapDelta = (t.nextTurnSwapDelta ?? 0) - 2;
      logText(state, `${t.name} 下回合换牌次数 -2（餐车投毒）`);
    }),
  );
  registerEffect(
    targetDebuff(
      "044",
      "选择下回合技能失效的玩家（可含自己）",
      (state, t) => {
        t.nextTurnSkillDisabled = true;
        logText(state, `${t.name} 下回合技能失效（暂时失忆）`);
      },
      { includeSelf: true },
    ),
  );
  // TODO: 035 黑厢抢夺（轮流掷骰比大小，需骰子交互，与 role:08 海盗一并留 M3）

  // ── 备用道具（规则 5.6：使用时触发，使用后背面朝上弃入黑市回收站）─────────
  // 045 信号干扰器：随机弃1抽1
  registerEffect(itemEffect("045", (s, ctx) => {
    const p = getPlayer(s, ctx);
    // 随机弃1张（若有手牌）
    if (p.zones.hand.length > 0) {
      const picks = shuffle(s, [...p.zones.hand]).slice(0, 1);
      const ids = new Set(picks.map((c) => c.id));
      p.zones.hand = p.zones.hand.filter((c) => !ids.has(c.id));
      p.zones.discard.push(...picks);
      logText(s, `${p.name} 随机弃置 1 张`);
    }
    // 抽1张
    if (p.zones.draw.length === 0) {
      if (p.zones.discard.length > 0) {
        p.zones.draw = shuffle(s, p.zones.discard.splice(0));
      }
    }
    if (p.zones.draw.length > 0) {
      p.zones.hand.push(p.zones.draw.shift()!);
      logText(s, `${p.name} 抽 1 张`);
    }
  }));

  // 046 广播喇叭：宣称临时特权证，结算时判断
  registerEffect(itemEffect("046", (s, ctx) => {
    const p = getPlayer(s, ctx);
    p.declarations = { ...(p.declarations ?? {}), "item:046": "declared" };
    logText(s, `${p.name} 宣称将获得【临时特权证】`);
  }));

  // 047 赌徒虹膜：猜测对手的牌型，结算时判定（猜中得3血筹，对手车票-4）
  registerEffect(itemEffect(
    "047",
    (s, ctx) => {
      const p = getPlayer(s, ctx);
      const opponents = s.players.filter((x) => x.id !== p.id);
      if (opponents.length === 0) return;
      // 单对手直接选牌型；多对手合并对手+牌型一步选
      if (opponents.length === 1) {
        promptChooseOption(s, "item:047", p.id, [
          { id: "高牌", label: "高牌" }, { id: "一对", label: "一对" }, { id: "两对", label: "两对" },
          { id: "三条", label: "三条" }, { id: "顺子", label: "顺子" }, { id: "同花", label: "同花" },
          { id: "葫芦", label: "葫芦" }, { id: "四条", label: "四条" },
          { id: "同花顺", label: "同花顺" }, { id: "五条", label: "五条" },
        ], `猜测 ${opponents[0]!.name} 的牌型是？`);
        s.pendingPrompt!.carry = opponents[0]!.id;
      } else {
        const options = opponents.flatMap((op) =>
          ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺", "五条"].map((cat) => ({
            id: `${op.id}:${cat}`,
            label: `猜 ${op.name} 为【${cat}】`,
          })),
        );
        promptChooseOption(s, "item:047", p.id, options, "选择对手并猜测其牌型");
      }
    },
    (s, ctx, choice) => {
      const p = getPlayer(s, ctx);
      const choiceStr = String(choice);
      let opponentId: string;
      let category: string;
      if (choiceStr.includes(":")) {
        [opponentId, category] = choiceStr.split(":");
      } else {
        // 单对手情况：carry 存 opponentId，choice 是 category
        opponentId = s.pendingPrompt ? (s.pendingPrompt as any).carry ?? choiceStr : choiceStr;
        category = choiceStr;
      }
      p.declarations = { ...(p.declarations ?? {}), "item:047": `${opponentId}:${category}` };
      logText(s, `${p.name} 猜测 ${s.players.find((x) => x.id === opponentId)?.name ?? opponentId} 为【${category}】`);
    },
  ));

  // 048 皮下密信：花2血筹抽3张
  registerEffect(itemEffect("048", (s, ctx) => {
    const p = getPlayer(s, ctx);
    if (p.chips < 2) {
      logText(s, `${p.name} 血筹不足2，无法使用皮下密信`);
      return;
    }
    p.chips -= 2;
    let drawn = 0;
    for (let i = 0; i < 3; i++) {
      if (p.zones.draw.length === 0) {
        if (p.zones.discard.length === 0) break;
        p.zones.draw = shuffle(s, p.zones.discard.splice(0));
      }
      p.zones.hand.push(p.zones.draw.shift()!);
      drawn++;
    }
    logText(s, `${p.name} 花2血筹抽${drawn}张`);
  }));

  // 049 防护屏障：取消针对自己的秘密交易（效果延迟到下回合；本版本占位）
  registerEffect(itemEffect("049", (s, ctx) => {
    const p = getPlayer(s, ctx);
    // TODO: 取消下一个针对自己的秘密交易或道具效果（需要 effect hook 系统支持）
    p.declarations = { ...(p.declarations ?? {}), "item:049": "active" };
    logText(s, `${p.name} 激活防护屏障`);
  }));

  // 050 魔术橡皮：宣称一种牌型，本回合视为高牌
  registerEffect(itemEffect(
    "050",
    (s, ctx) => {
      const p = getPlayer(s, ctx);
      promptChooseOption(s, "item:050", p.id, [
        { id: "高牌", label: "高牌" }, { id: "一对", label: "一对" }, { id: "两对", label: "两对" },
        { id: "三条", label: "三条" }, { id: "顺子", label: "顺子" }, { id: "同花", label: "同花" },
        { id: "葫芦", label: "葫芦" }, { id: "四条", label: "四条" },
        { id: "同花顺", label: "同花顺" }, { id: "五条", label: "五条" },
      ], "宣称本回合视为哪种牌型？");
    },
    (s, ctx, choice) => {
      const p = getPlayer(s, ctx);
      const cat = String(choice);
      p.declarations = { ...(p.declarations ?? {}), "item:050": cat };
      logText(s, `${p.name} 宣称本回合牌型视为【${cat}】`);
    },
  ));

  // 051 消磁枪：令对手1张芯片失效
  registerEffect(itemEffect(
    "051",
    (s, ctx) => {
      const p = getPlayer(s, ctx);
      const opponents = s.players.filter((x) => x.id !== p.id);
      if (opponents.length === 0) return;
      const chipsWithPlayers = opponents
        .flatMap((op) =>
          Object.entries(op.zones.chips).map(([cardId, chipDefId]) => ({ player: op, cardId, chipDefId })),
        )
        .filter((x) => x.chipDefId);
      if (chipsWithPlayers.length === 0) {
        logText(s, `${p.name} 周围无强化芯片，消磁枪未生效`);
        return;
      }
      if (chipsWithPlayers.length === 1) {
        chipsWithPlayers[0]!.player.disabledChipCards = [
          ...(chipsWithPlayers[0]!.player.disabledChipCards ?? []),
          chipsWithPlayers[0]!.cardId,
        ];
        logText(s, `${p.name} 使用消磁枪令 ${chipsWithPlayers[0]!.player.name} 的芯片失效`);
        return;
      }
      // 编码为 "playerId|cardId" 以便 resolve 时找到目标玩家
      promptChooseOption(s, "item:051", p.id, chipsWithPlayers.map((x) => ({
        id: `${x.player.id}|${x.cardId}`,
        label: `令 ${x.player.name} 的 ${x.cardId} 上的芯片失效`,
      })), "选择要失效的芯片");
    },
    (s, ctx, choice) => {
      const choiceStr = String(choice);
      const sepIdx = choiceStr.indexOf("|");
      if (sepIdx === -1) return;
      const playerId = choiceStr.slice(0, sepIdx);
      const cardId = choiceStr.slice(sepIdx + 1);
      const target = s.players.find((x) => x.id === playerId);
      if (!target) return;
      target.disabledChipCards = [...(target.disabledChipCards ?? []), cardId];
      const p = getPlayer(s, ctx);
      logText(s, `${p.name} 使用消磁枪令 ${target.name} 的芯片失效`);
    },
  ));

  // 052 荷官证：本回合改为比较总点数
  registerEffect(itemEffect("052", (s, ctx) => {
    const p = getPlayer(s, ctx);
    p.declarations = { ...(p.declarations ?? {}), "item:052": "totalPoints" };
    logText(s, `${p.name} 使用荷官证，本回合改为比较总点数`);
  }));

  // ── 道具结算效果（规则 5.6）──────────────────────────────────────────────
  /** 046 广播喇叭【结算阶段】：宣称者夺魁则得 (人数×3) 血筹，否则跳过本回合购买/删牌/重整 */
  registerEffect({
    id: "item:046:settle",
    source: "blackMarket",
    phase: "settle",
    timing: "after",
    run: (s) => {
      for (const p of s.players) {
        if (p.declarations?.["item:046"] !== "declared") continue;
        delete p.declarations!["item:046"];
        const passHolder = s.players.find((x) => x.seat === s.passHolderSeat);
        if (passHolder && p.id === passHolder.id) {
          const reward = s.players.length * 3;
          p.chips += reward;
          logText(s, `${p.name} 夺魁且宣称广播喇叭，获得 ${reward} 血筹`);
        } else {
          p.skipPhases = [...(p.skipPhases ?? []), "purchase", "delete", "reshape"];
          logText(s, `${p.name} 未夺魁，广播喇叭失效，跳过购买/删牌/重整`);
        }
      }
    },
  });

  /** 047 赌徒虹膜【结算阶段】：猜中对手牌型则得 3 血筹，对手车票 -4（最低 0） */
  registerEffect({
    id: "item:047:settle",
    source: "blackMarket",
    phase: "settle",
    timing: "after",
    run: (s) => {
      for (const p of s.players) {
        const decl = p.declarations?.["item:047"];
        if (!decl) continue;
        delete p.declarations!["item:047"];
        const colonIdx = decl.indexOf(":");
        if (colonIdx === -1) continue;
        const opponentId = decl.slice(0, colonIdx);
        const guessedCat = decl.slice(colonIdx + 1);
        const opponent = s.players.find((x) => x.id === opponentId);
        if (!opponent) continue;
        const oppEntry = s.duelResult?.find((e) => e.playerId === opponentId);
        if (!oppEntry) continue;
        // 把猜测的牌型字符串映射到 HandCategory 数值
        const catMap: Record<string, number> = {
          "高牌": 1, "一对": 2, "两对": 3, "三条": 4, "顺子": 5,
          "同花": 6, "葫芦": 7, "四条": 8, "同花顺": 9, "五条": 10,
          "同花葫芦": 11, "同花五条": 12, "六条": 13, "同花六条": 14,
        };
        const guessedRank = catMap[guessedCat];
        if (guessedRank === undefined) continue;
        if (oppEntry.category === guessedRank) {
          p.chips += 3;
          logText(s, `${p.name} 猜中 ${opponent.name} 牌型【${guessedCat}】，获得 3 血筹`);
        } else {
          const orig = oppEntry.category;
          const oppCatName = Object.entries(catMap).find(([, v]) => v === orig)?.[0] ?? String(orig);
          logText(s, `${p.name} 猜错 ${opponent.name} 牌型（实际【${oppCatName}】），未获得奖励`);
        }
        // 对手本回合车票 -4（最低 0）
        opponent.tickets = Math.max(0, opponent.tickets - 4);
      }
    },
  });

  // ── 强化芯片：非黄边（简单类注册，复杂类 TODO）────────────────────────────
  registerEffect(chipInstall({ defId: "013" })); // 空白模板：无效果
  // 018/019/020 血幕镀层系：结算阶段对芯片持有者按特权证条件结算（020 为"若不持有"）
  registerEffect(passHolderBonus("market:018:settle", { tickets: 2 }, "chip", { chipDefId: "018" }));
  registerEffect(passHolderBonus("market:019:settle", { chips: 4 }, "chip", { chipDefId: "019" }));
  registerEffect(
    passHolderBonus("market:020:settle", { chips: 3 }, "chip", { chipDefId: "020", negate: true }),
  );
  // 025 自毁芯片（结算结束时）：删除持有者本回合打出的所有牌（含插芯片的牌）
  // 打出牌在结算时已入弃牌区（resolveDuel 的 play→discard），按 duelResult 回溯本回合打出的牌 id（去 #dup 后缀），
  // 删除时同步清理其上挂载的芯片（金科玉律 10）。
  registerEffect({
    id: "market:025:settle",
    source: "blackMarket",
    phase: "settle",
    timing: "after",
    run: (state) => {
      for (const p of chipHolders(state, "025")) {
        const entry = state.duelResult?.find((e) => e.playerId === p.id);
        if (!entry || entry.cards.length === 0) continue;
        const ids = new Set(entry.cards.map((c) => c.id.split("#")[0]!));
        const doomed = p.zones.discard.filter((c) => ids.has(c.id));
        if (doomed.length === 0) continue;
        p.zones.discard = p.zones.discard.filter((c) => !ids.has(c.id));
        for (const c of doomed) {
          delete p.zones.chips[c.id];
          p.zones.deleted.push(c);
        }
        logText(state, `${p.name} 自毁芯片：删除本回合打出的 ${doomed.length} 张牌`);
      }
    },
  });
  // TODO: 014 仿制印章（视为出牌区另一张，需选牌交互）、015 复制芯片（复制他人芯片，需选芯片交互）、
  // 016 磁力线圈（重洗前挑牌放顶）、023 弹簧夹层（花血筹临时改点数）、024 屏蔽器（令一张芯片失效）——
  // 需交互或状态扩展，留后续。

  // ── 阶段时机效果（对决/结算 during，resolveTiming 触发）───────────────────
  registerEffect({
    id: "market:021:during:duel",
    source: "blackMarket",
    phase: "duel",
    timing: "during",
    run: (state) => {
      for (const p of chipHolders(state, "021")) {
        p.chips += 2;
        logText(state, `${p.name} 血幕镀层（出）：对决获得 2 血筹`);
      }
    },
  });
  registerEffect({
    id: "market:022:during:duel",
    source: "blackMarket",
    phase: "duel",
    timing: "during",
    run: (state) => {
      const holder = chipHolders(state, "022")[0];
      if (!holder || state.pendingPrompt) return;
      const opponents = state.players.filter((p) => p.id !== holder.id).map((p) => p.id);
      if (opponents.length === 0) return;
      promptChoosePlayer(state, "market:022:during:duel", holder.id, opponents, "选择抢夺 1 血筹的对手");
    },
    resolve: (state, ctx, choice) => {
      const holder = chipHolders(state, "022")[0];
      if (!holder) return;
      const targetId = Array.isArray(choice) ? choice[0]! : choice;
      spendChips(1)(state, { ...ctx, playerId: targetId });
      gainChips(1)(state, { ...ctx, playerId: holder.id });
    },
  });
  // 008-012/017 的声明已由 chipViewFromChips 在判定阶段消费（见 mergeChipView），
  // 019/020 的"结算时若（不）持有【临时特权证】"已注册为 (settle, after)。

  // ── 秘密交易（购买立即结算，非交互自动类）─────────────────────────────────
}

/** 027 廉价删除：可免费删除至多 2 张自己弃牌堆的牌（金科玉律 10 带芯片一同删除） */
function cheapDelete(): EffectDef {
  return {
    id: "market:027",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      const candidates = p.zones.discard.map((c) => c.id);
      if (candidates.length === 0) {
        logText(state, "market:027 无可删牌，效果无目标");
        return;
      }
      promptChooseCard(state, "market:027", ctx.playerId!, candidates, "discard", "选择要删除的牌（至多 2 张）");
    },
    resolve: (state, ctx, choice) => {
      // 卡面「可删除至多 2 张牌」（票据 24 核对修复）：超出部分截断，防止一次删任意数量
      const ids = (Array.isArray(choice) ? choice : [choice]).slice(0, 2);
      if (ids.length === 0) {
        logText(state, "market:027 未选择删除任何牌");
        return;
      }
      deleteCards(ids, { free: 2 })(state, ctx);
    },
  };
}

/** 031 暴力删除：选择自己或一位对手，删除其抽牌堆顶 3 张（目标抽牌堆须至少有 3 张） */
function violentDelete(): EffectDef {
  return {
    id: "market:031",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const candidates = state.players.filter((pl) => pl.zones.draw.length >= 3).map((pl) => pl.id);
      if (candidates.length === 0) {
        logText(state, "market:031 无人抽牌堆有 3 张牌，该黑市牌弃置");
        return;
      }
      promptChoosePlayer(state, "market:031", ctx.playerId!, candidates, "选择删除谁抽牌堆顶的 3 张牌");
    },
    resolve: (state, ctx, choice) => {
      const target = findPlayer(state, Array.isArray(choice) ? choice[0]! : choice);
      const picks = target.zones.draw.splice(0, 3);
      target.zones.deleted.push(...picks);
      logText(state, `${target.name} 抽牌堆顶 ${picks.length} 张牌被删除（暴力删除）`);
    },
  };
}

/** 034 货箱盲掏：免费获得黑市牌堆顶的 1 张牌，并按该牌类型走购买结算（强化芯片挂起/秘密交易立即/道具存 items） */
function freeTopCard(): EffectDef {
  return {
    id: "market:034",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      const top = state.blackMarket.supply.shift();
      if (!top) {
        logText(state, "market:034 黑市供应堆已空，无牌可拿");
        return;
      }
      const def = getEffect(`market:${top.defId}`);
      if (def) {
        def.run(state, { config: ctx.config, playerId: ctx.playerId, effectId: def.id });
        return;
      }
      if (top.subtype === "备用道具" || top.subtype === "道具") {
        p.zones.items.push(top.defId);
        logText(state, `${p.name} 免费获得备用道具 ${top.defId}`);
        return;
      }
      logText(state, `market:034 免费获得 ${top.defId}（效果未实现）`);
    },
  };
}

/** 036 对赌协议：投一次骰子，获得骰子点数的血筹 */
function diceGain(): EffectDef {
  return {
    id: "market:036",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const n = rollDice(state);
      gainChips(n)(state, ctx);
    },
  };
}

/** 039 鬼手探囊：获得临时特权证 */
function passGrab(): EffectDef {
  return {
    id: "market:039",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      state.passHolderSeat = p.seat;
      logText(state, `${p.name} 获得临时特权证（鬼手探囊）`);
    },
  };
}

/** 041 血筹分享：获得 5 血筹，其他每位对手获得 1 血筹 */
function shareChips(): EffectDef {
  return {
    id: "market:041",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      gainChips(5)(state, ctx);
      for (const pl of state.players) {
        if (pl.id !== p.id) gainChips(1)(state, { ...ctx, playerId: pl.id });
      }
    },
  };
}

/** 042 拔除芯片：拔除自己弃牌堆中的 1 张强化芯片，获得 4 血筹（牌留在弃牌区，票据 24 核对修复） */
function pluckChip(): EffectDef {
  return {
    id: "market:042",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      const candidates = p.zones.discard.filter((c) => c.id in p.zones.chips).map((c) => c.id);
      if (candidates.length === 0) {
        logText(state, "market:042 弃牌堆无带强化芯片的牌，该黑市牌弃置");
        return;
      }
      promptChooseCard(state, "market:042", ctx.playerId!, candidates, "discard", "选择要拔除的强化芯片所在牌");
    },
    resolve: (state, ctx, choice) => {
      const cardId = Array.isArray(choice) ? choice[0]! : choice;
      removeChip(cardId)(state, ctx); // 只拔芯片（含还原数值类点数修正），牌继续留在弃牌区
      gainChips(4)(state, ctx);
    },
  };
}

registerMarketEffects();
