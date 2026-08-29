/**
 * 效果原语库(M2.1,grilling Q1/Q7:同模式卡用工厂复用,杜绝每张牌重复写)。
 *
 * 每个原语是一个高阶工厂:EffectBody = (state, ctx) => void,
 * 与 EffectDef.run 签名一致,直接变更 reducer 传入的工作副本。
 * 效果注册代码 = 原语组合(不写 DSL,保持硬编码可读性)。
 */
import type { Card } from "../cards.js";
import type { EffectContext } from "../core/effects.js";
import type { GameState, PlayerState } from "../core/state.js";
import { nextInt, shuffle } from "../core/rng.js";

export type EffectBody = (state: GameState, ctx: EffectContext) => void;

/** 取效果触发玩家(ctx.playerId 可能为 null:规则书类效果) */
export function getPlayer(state: GameState, ctx: EffectContext): PlayerState {
  if (!ctx.playerId) throw new Error(`效果 ${ctx.effectId ?? "?"} 需要 playerId,实际为 null`);
  const p = state.players.find((x) => x.id === ctx.playerId);
  if (!p) throw new Error(`玩家不存在: ${ctx.playerId}`);
  return p;
}

/** 按座位/id 取任意玩家(交互目标等) */
export function findPlayer(state: GameState, playerId: string): PlayerState {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) throw new Error(`玩家不存在: ${playerId}`);
  return p;
}

export function logText(state: GameState, text: string): void {
  state.log.push({ turn: state.turn, phase: state.phase, text });
}

const nameOf = (p: PlayerState | undefined): string => p?.name ?? "规则书";

/** 获得血筹(公开信息,可超上限,金科玉律 12) */
export const gainChips =
  (n: number): EffectBody =>
  (state, ctx) => {
    const p = getPlayer(state, ctx);
    p.chips += n;
    logText(state, `${nameOf(p)} 获得 ${n} 血筹`);
  };

/** 失去血筹(不足则扣至 0,不取负) */
export const spendChips =
  (n: number): EffectBody =>
  (state, ctx) => {
    const p = getPlayer(state, ctx);
    const actual = Math.min(n, p.chips);
    p.chips -= actual;
    logText(state, `${nameOf(p)} 失去 ${actual} 血筹${actual < n ? "（不足，按实际扣）" : ""}`);
  };

/** 获得车票 */
export const gainTickets =
  (n: number): EffectBody =>
  (state, ctx) => {
    const p = getPlayer(state, ctx);
    p.tickets += n;
    logText(state, `${nameOf(p)} 获得 ${n} 车票`);
  };

/** 失去车票(最低 0) */
export const spendTickets =
  (n: number): EffectBody =>
  (state, ctx) => {
    const p = getPlayer(state, ctx);
    const actual = Math.min(n, p.tickets);
    p.tickets -= actual;
    logText(state, `${nameOf(p)} 失去 ${actual} 车票`);
  };

/** 修改剩余换牌次数(可为负,由 reducer 校验不越界) */
export const modifySwapLeft =
  (n: number): EffectBody =>
  (state, ctx) => {
    const p = getPlayer(state, ctx);
    p.swapLeft = Math.max(0, p.swapLeft + n);
  };

/** 技能本回合失效(暂时失忆等) */
export const disableSkill =
  (targetId?: string): EffectBody =>
  (state, ctx) => {
    const p = targetId ? findPlayer(state, targetId) : getPlayer(state, ctx);
    p.skillDisabled = true;
    logText(state, `${p.name} 本回合技能失效`);
  };

/** 强化芯片本回合失效(磁山隧道等) */
export const disableChips =
  (targetId?: string): EffectBody =>
  (state, ctx) => {
    const p = targetId ? findPlayer(state, targetId) : getPlayer(state, ctx);
    p.chipsDisabled = true;
    logText(state, `${p.name} 本回合强化芯片失效`);
  };

/**
 * 牌点数永久修正(校准器/限流阀:金科玉律 4 点数范围 2-14)。
 * 超出范围:不可插入,日志提示(规则书:超出范围则不可插入)。
 */
export function addPermanentRank(cardId: string, delta: number): EffectBody {
  return (state, ctx) => {
    const p = getPlayer(state, ctx);
    const card = [...p.zones.discard, ...p.zones.hand, ...p.zones.draw, ...p.zones.play].find(
      (c) => c.id === cardId,
    );
    if (!card) throw new Error(`找不到牌 ${cardId} 以修正点数`);
    const next = (card.rank ?? 0) + delta;
    if (next < 2 || next > 14) {
      logText(state, `${card.id} 点数将超出 2-14(${next})，强化失败`);
      return;
    }
    card.rank = next;
    logText(state, `${card.id} 点数 ${delta > 0 ? "+" : ""}${delta} → ${next}`);
  };
}

/** 掷骰 1-6(用 state 内嵌 RNG,可重放) */
export function rollDice(state: GameState): number {
  return nextInt(state, 6) + 1;
}

/** 从数组随机取一个(不修改数组) */
export function randomOf<T>(state: GameState, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[nextInt(state, arr.length)];
}

/** 重洗某玩家的牌库(弃牌区并入抽牌堆) */
export const reshuffleDraw =
  (targetId?: string): EffectBody =>
  (state, ctx) => {
    const p = targetId ? findPlayer(state, targetId) : getPlayer(state, ctx);
    p.zones.draw = shuffle(state, [...p.zones.draw, ...p.zones.discard.splice(0)]);
    logText(state, `${p.name} 重洗牌库`);
  };

/** 抽 n 张牌(抽牌堆不足自动重洗弃牌堆) */
export const drawCards =
  (n: number): EffectBody =>
  (state, ctx) => {
    const p = getPlayer(state, ctx);
    let left = n;
    while (left > 0) {
      if (p.zones.draw.length === 0) {
        if (p.zones.discard.length === 0) break;
        p.zones.draw = shuffle(state, p.zones.discard.splice(0));
        logText(state, `${p.name} 重洗弃牌堆组成新抽牌堆`);
      }
      p.zones.hand.push(p.zones.draw.shift()!);
      left -= 1;
    }
    if (left > 0) logText(state, `${p.name} 仅抽到 ${n - left} 张牌（牌库与弃牌堆均无牌）`);
  };

/** 从手牌随机弃 n 张(秘密交易「随机弃牌」类) */
export const discardRandomHand =
  (n: number): EffectBody =>
  (state, ctx) => {
    const p = getPlayer(state, ctx);
    const picks = shuffle(state, [...p.zones.hand]).slice(0, Math.min(n, p.zones.hand.length));
    const ids = new Set(picks.map((c) => c.id));
    p.zones.hand = p.zones.hand.filter((c) => !ids.has(c.id));
    p.zones.discard.push(...picks);
    logText(state, `${p.name} 随机弃置 ${picks.length} 张牌`);
  };

/** 删除弃牌区中的牌(移入删牌区;带强化芯片的一同删除,金科玉律 10) */
export const deleteFromDiscard =
  (cardId: string, targetId?: string): EffectBody =>
  (state, ctx) => {
    const p = targetId ? findPlayer(state, targetId) : getPlayer(state, ctx);
    const idx = p.zones.discard.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new Error(`${p.name} 弃牌区找不到 ${cardId}`);
    const [c] = p.zones.discard.splice(idx, 1);
    p.zones.deleted.push(c!);
    delete p.zones.chips[cardId]; // 芯片随牌进删牌区,不残留挂载记录
    logText(state, `${p.name} 删除 ${cardId}`);
  };

/** 把一张牌放到抽牌堆顶(磁力线圈等) */
export const moveToDrawTop =
  (cardId: string, targetId?: string): EffectBody =>
  (state, ctx) => {
    const p = targetId ? findPlayer(state, targetId) : getPlayer(state, ctx);
    const idx = p.zones.discard.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new Error(`${p.name} 弃牌区找不到 ${cardId}`);
    const [c] = p.zones.discard.splice(idx, 1);
    p.zones.draw.unshift(c!);
    logText(state, `${p.name} 将 ${cardId} 置于抽牌堆顶`);
  };

/** 移除出牌区全部牌(高中生「出牌区全部弃置」) */
export const clearPlayZone = (): EffectBody => (state, ctx) => {
  const p = getPlayer(state, ctx);
  p.zones.discard.push(...p.zones.play.splice(0));
  logText(state, `${p.name} 弃置出牌区全部牌`);
};

/** 免费/付费删除一次的可复用器:付费删除 n 张(金科玉律:只可删自己弃牌区) */
export function deleteCards(
  cardIds: string[],
  opts: { free?: number; costPer?: number } = {},
): EffectBody {
  return (state, ctx) => {
    const p = getPlayer(state, ctx);
    const free = opts.free ?? 0;
    const costPer = opts.costPer ?? 0;
    const ids = new Set(cardIds);
    const moving = p.zones.discard.filter((c) => ids.has(c.id));
    if (moving.length !== cardIds.length) throw new Error("弃牌区中找不到待删的牌");
    const paid = Math.max(0, moving.length - free);
    const cost = paid * costPer;
    if (p.chips < cost) throw new Error(`血筹不足，需 ${cost} 筹`);
    p.chips -= cost;
    p.zones.discard = p.zones.discard.filter((c) => !ids.has(c.id));
    for (const c of moving) {
      p.zones.deleted.push(c);
      delete p.zones.chips[c.id];
    }
    logText(state, `${p.name} 删除 ${moving.length} 张牌${cost > 0 ? `（付 ${cost} 筹）` : "（免费）"}`);
  };
}

/** 占位效果:注册表缺失时降级(无效果,仅日志;issue 06 约定) */
export const placeholderEffect: EffectBody = (state, ctx) => {
  logText(state, `效果未实现: ${ctx.effectId ?? "unknown"}`);
};

/** 从 Card 数组导出便捷工具(供效果注册代码查牌) */
export function findCardInZones(p: PlayerState, cardId: string): Card | undefined {
  for (const zone of [p.zones.hand, p.zones.discard, p.zones.draw, p.zones.play, p.zones.deleted]) {
    const c = zone.find((x) => x.id === cardId);
    if (c) return c;
  }
  return undefined;
}
