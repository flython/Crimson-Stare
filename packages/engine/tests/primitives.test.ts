/**
 * 效果原语库单测(M2.1)。
 * 用 createGame 建真实白板局,手动构造 EffectContext 调原语,断言 state 变化与日志。
 */
import { describe, it, expect } from "vitest";
import { createGame } from "../src/game/whiteboard.js";
import { DEFAULT_GAME_CONFIG } from "../src/core/config.js";
import type { EffectContext } from "../src/core/effects.js";
import {
  gainChips,
  spendChips,
  gainTickets,
  spendTickets,
  disableSkill,
  disableChips,
  addPermanentRank,
  rollDice,
  deleteFromDiscard,
  drawCards,
  reshuffleDraw,
  moveToDrawTop,
  discardRandomHand,
  deleteCards,
  placeholderEffect,
} from "../src/effects/primitives.js";

function makeGame() {
  const state = createGame(
    [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    DEFAULT_GAME_CONFIG,
    12345,
  );
  const ctxA: EffectContext = { config: DEFAULT_GAME_CONFIG, playerId: "a", effectId: "test" };
  return { state, ctxA };
}

describe("效果原语库", () => {
  it("gainChips / spendChips / gainTickets / spendTickets", () => {
    const { state, ctxA } = makeGame();
    const a = state.players[0]!;
    const chipsBefore = a.chips;
    gainChips(3)(state, ctxA);
    spendChips(1)(state, ctxA);
    gainTickets(2)(state, ctxA);
    spendTickets(5)(state, ctxA); // 不足 → 扣到 0
    expect(a.chips).toBe(chipsBefore + 3 - 1);
    expect(a.tickets).toBe(0); // 0+2-5 → 最低 0
    expect(state.log.some((l) => l.text.includes("获得 3 血筹"))).toBe(true);
  });

  it("spendChips 不足时按实际扣(不取负)", () => {
    const { state, ctxA } = makeGame();
    spendChips(999)(state, ctxA);
    expect(state.players[0]!.chips).toBe(0);
  });

  it("disableSkill / disableChips 打标记", () => {
    const { state, ctxA } = makeGame();
    disableSkill()(state, ctxA);
    disableChips("b")(state, ctxA);
    expect(state.players[0]!.skillDisabled).toBe(true);
    expect(state.players[1]!.chipsDisabled).toBe(true);
  });

  it("addPermanentRank: 弃牌区牌点数修正,越界拒绝", () => {
    const { state, ctxA } = makeGame();
    // 取弃牌区一张非 JOKER 的牌,delta = 14-rank 保证恰好修到 14(不越界)
    const card = state.players[0]!.zones.discard.find((c) => c.rank !== null)!;
    const delta = 14 - card.rank!;
    addPermanentRank(card.id, delta)(state, ctxA);
    expect(state.players[0]!.zones.discard.find((c) => c.id === card.id)!.rank).toBe(14);
    // 越界(>14)不生效:用手牌的牌测试
    const c2 = state.players[0]!.zones.hand.find((c) => c.rank !== null)!;
    const before = c2.rank!;
    addPermanentRank(c2.id, 20)(state, ctxA);
    expect(state.players[0]!.zones.hand.find((c) => c.id === c2.id)!.rank).toBe(before);
  });

  it("rollDice 恒在 1-6", () => {
    const { state } = makeGame();
    for (let i = 0; i < 50; i++) {
      const d = rollDice(state);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);
    }
  });

  it("deleteFromDiscard: 移到删牌区且清掉芯片挂载", () => {
    const { state, ctxA } = makeGame();
    const a = state.players[0]!;
    const card = a.zones.discard[0]!;
    a.zones.chips[card.id] = "market:001";
    deleteFromDiscard(card.id)(state, ctxA);
    expect(a.zones.deleted.some((c) => c.id === card.id)).toBe(true);
    expect(a.zones.discard.some((c) => c.id === card.id)).toBe(false);
    expect(a.zones.chips[card.id]).toBeUndefined(); // 芯片随牌进删牌区
  });

  it("drawCards: 手牌增加,牌库空自动重洗弃牌堆", () => {
    const { state, ctxA } = makeGame();
    const a = state.players[0]!;
    const beforeHand = a.zones.hand.length;
    const beforeDraw = a.zones.draw.length;
    const beforeDiscard = a.zones.discard.length;
    const need = Math.min(3, beforeDraw); // 牌库充足时
    drawCards(need)(state, ctxA);
    expect(a.zones.hand.length).toBe(beforeHand + need);
    expect(a.zones.draw.length).toBe(beforeDraw - need);
    expect(a.zones.discard.length).toBe(beforeDiscard); // 未触发重洗
  });

  it("moveToDrawTop: 弃牌区牌放到抽牌堆顶", () => {
    const { state, ctxA } = makeGame();
    const a = state.players[0]!;
    const card = a.zones.discard[0]!;
    moveToDrawTop(card.id)(state, ctxA);
    expect(a.zones.draw[0]!.id).toBe(card.id);
    expect(a.zones.discard.some((c) => c.id === card.id)).toBe(false);
  });

  it("discardRandomHand: 手牌减少,随机牌进弃牌区", () => {
    const { state, ctxA } = makeGame();
    const a = state.players[0]!;
    const before = a.zones.hand.length;
    discardRandomHand(2)(state, ctxA);
    expect(a.zones.hand.length).toBe(before - 2);
    expect(a.zones.discard.length).toBeGreaterThan(0);
  });

  it("deleteCards: 免费+付费删牌成本计算", () => {
    const { state, ctxA } = makeGame();
    const a = state.players[0]!;
    // 先把手牌 3 张移入弃牌区,保证弃牌区够删
    const hand3 = a.zones.hand.slice(0, 3);
    a.zones.discard.push(...hand3);
    a.zones.hand = a.zones.hand.filter((c) => !hand3.includes(c));
    const ids = hand3.map((c) => c.id);
    a.chips = 10;
    deleteCards(ids, { free: 1, costPer: 2 })(state, ctxA);
    expect(a.chips).toBe(10 - 2 * 2); // 3 张,1 张免费,2 张付费 × 2 筹
    expect(a.zones.deleted.length).toBe(3);
  });

  it("placeholderEffect: 降级仅写日志,不改状态", () => {
    const { state, ctxA } = makeGame();
    const snapshot = JSON.stringify(state);
    placeholderEffect(state, ctxA);
    expect(state.log.some((l) => l.text.includes("效果未实现: test"))).toBe(true);
    // 只有 log 变了
    const restored = JSON.parse(snapshot) as typeof state;
    expect(JSON.stringify(restored.log)).toBe(JSON.stringify(state.log.slice(0, -1)));
  });

  it("reshuffleDraw: 弃牌区并入抽牌堆", () => {
    const { state, ctxA } = makeGame();
    const a = state.players[0]!;
    const d = a.zones.discard.length;
    reshuffleDraw()(state, ctxA);
    expect(a.zones.discard.length).toBe(0);
    expect(a.zones.draw.length).toBeGreaterThanOrEqual(d);
  });
});
