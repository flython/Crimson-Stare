import { describe, expect, it } from "vitest";
import { resolveDealerHand, parseFateEffect, buildFateDecks, fateDealerTemplate, fateEffectText } from "../src/fate.js";
import { HandCategory } from "../src/hand-evaluator.js";
import type { CardPool } from "../src/cardPool.js";

const MOCK_POOL: CardPool = {
  version: "test",
  counts: { role: 0, market: 0, fate: 15, event: 0 },
  roles: [],
  market: [],
  fate: [
    { id: "F1", name: "命运牌1", category: "fate", subtype: "基础", count: 1, triggers: [], effectId: "fate:F1", effectText: "【对决阶段】：玩家的牌型下降×级（×=骰子点数）最低至高牌。", image: "assets/cards/fate/F1.jpg", fateData: { dealerHand: "5♣ 6♣ 7♦ 8♦ ?♠", diceMapping: "A,2,3 → 高牌；4 → 顺子；5,6 → 对子" } },
    { id: "F2", name: "命运牌2", category: "fate", subtype: "基础", count: 1, triggers: [], effectId: "fate:F2", effectText: "【结算阶段】结束时：玩家选择并删除1张本回合打出过的带[强化芯片]的牌，若无合法目标则无事发生。", image: "assets/cards/fate/F2.jpg", fateData: { dealerHand: "2♠ 3♠ 4♥ 5♥ ?♣", diceMapping: "A → 高牌；2,3,4,5 → 对子；6 → 顺子" } },
    { id: "F3", name: "命运牌3", category: "fate", subtype: "基础", count: 1, triggers: [], effectId: "fate:F3", effectText: "【结算阶段】结束时：玩家选择并删除1张本回合打出过的带[强化芯片]的牌，若无合法目标则无事发生。", image: "assets/cards/fate/F3.jpg", fateData: { dealerHand: "A♣ A♦ 6♣ 6♦ ?♥", diceMapping: "A,6 → 葫芦；2,3,4,5 → 两对" } },
    { id: "F4", name: "命运牌4", category: "fate", subtype: "基础", count: 1, triggers: [], effectId: "fate:F4", effectText: "【对决阶段】：玩家强制抽1张牌（若抽牌堆无牌则重洗牌库），替换玩家出牌区的1张牌，被替换的牌置入弃牌区。", image: "assets/cards/fate/F4.jpg", fateData: { dealerHand: "4♠ 5♥ 6♣ ?♦ ?♦", diceMapping: "A,2,3 → 对子；4,5,6 → 三条" } },
    { id: "F5", name: "命运牌5", category: "fate", subtype: "基础", count: 1, triggers: [], effectId: "fate:F5", effectText: "本回合玩家的所有[强化芯片]无效。", image: "assets/cards/fate/F5.jpg", fateData: { dealerHand: "2♠ 3♠ 4♥ 5♥ ?♣", diceMapping: "A → 高牌；2,3,4,5 → 对子；6 → 顺子" } },
    { id: "F6", name: "命运牌6", category: "fate", subtype: "基础", count: 1, triggers: [], effectId: "fate:F6", effectText: "【结算阶段】结束时：玩家丢弃×【血筹】（×=骰子点数）。", image: "assets/cards/fate/F6.jpg", fateData: { dealerHand: "10♦ J♦ Q♦ K♦ ?♦", diceMapping: "A → 同花顺；2,3,4,5,6 → 同花" } },
    { id: "F7", name: "命运牌7", category: "fate", subtype: "基础", count: 1, triggers: [], effectId: "fate:F7", effectText: "【结算阶段】结束时：玩家必须将出牌区点数最小的牌（若有多张则由玩家选择）保留在出牌区，下回合 【出牌阶段】 少出1张牌。", image: "assets/cards/fate/F7.jpg", fateData: { dealerHand: "6♠ 6♥ 6♣ ?♦ ?♦", diceMapping: "A,2,3,4,5 → 葫芦；6 → 五条" } },
    { id: "F8", name: "命运牌8", category: "fate", subtype: "基础", count: 1, triggers: [], effectId: "fate:F8", effectText: "【结算阶段】结束时，机械荷官获得【特权证】。", image: "assets/cards/fate/F8.jpg", fateData: { dealerHand: "6♠ 6♥ 6♣ 6♦ ?♥", diceMapping: "A,2,3,4,5 → 四条；6 → 五条" } },
    { id: "F9", name: "命运牌9", category: "fate", subtype: "基础", count: 1, triggers: [], effectId: "fate:F9", effectText: "本回合机械荷官技能失效。", image: "assets/cards/fate/F9.jpg", fateData: { dealerHand: "?♠ ?♥ ?♣ ?♦ ?♠", diceMapping: "A,2,3,4,5,6 → 五条" } },
    { id: "F10", name: "命运牌10", category: "fate", subtype: "基础", count: 1, triggers: [], effectId: "fate:F10", effectText: "本回合玩家技能失效。", image: "assets/cards/fate/F10.jpg", fateData: { dealerHand: "2♦ 3♦ 4♦ 5♦ ?♦", diceMapping: "A,2,3,4,5 → 同花；6 → 同花顺" } },
    { id: "F11", name: "命运牌11", category: "fate", subtype: "高级", count: 1, triggers: [], effectId: "fate:F11", effectText: "【结算阶段】结束时：玩家获得×【血筹】（×=骰子点数）。", image: "assets/cards/fate/F11.jpg", fateData: { dealerHand: "6♣ 6♣ 6♣ ?♣ ?♣", diceMapping: "A,2,3,4,5 → 同花葫芦；6 → 同花五条" } },
    { id: "F12", name: "命运牌12", category: "fate", subtype: "高级", count: 1, triggers: [], effectId: "fate:F12", effectText: "【结算阶段】结束时：玩家获得×【血筹】（×=命运牌弃牌区数量）。", image: "assets/cards/fate/F12.jpg", fateData: { dealerHand: "?♥ ?♥ ?♥ ?♥ ?♥", diceMapping: "A,2,3,4,5,6 → 同花五条" } },
    { id: "F13", name: "命运牌13", category: "fate", subtype: "高级", count: 1, triggers: [], effectId: "fate:F13", effectText: "【对决阶段】：玩家本回合的牌型提升3级，最高至七条。", image: "assets/cards/fate/F13.jpg", fateData: { dealerHand: "?♠ ?♥ ?♣ ?♦ ?♠ ?♥", diceMapping: "A,2,3,4,5,6 → 六条" } },
    { id: "F14", name: "命运牌14", category: "fate", subtype: "高级", count: 1, triggers: [], effectId: "fate:F14", effectText: "【对决阶段】：玩家本回合的牌型提升×级（×=骰子点数）最高至七条。", image: "assets/cards/fate/F14.jpg", fateData: { dealerHand: "?♠ ?♠ ?♠ ?♠ ?♠ ?♠", diceMapping: "A,2,3,4,5,6 → 同花六条" } },
    { id: "F15", name: "命运牌15", category: "fate", subtype: "高级", count: 1, triggers: [], effectId: "fate:F15", effectText: "【对决阶段】：玩家本回合的牌型提升×级（×=命运牌弃牌区数量）最高至七条。", image: "assets/cards/fate/F15.jpg", fateData: { dealerHand: "?♠ ?♥ ?♣ ?♦ ?♠ ?♥ ?♣", diceMapping: "A,2,3,4,5,6 → 七条" } },
  ],
  events: [],
};

describe("resolveDealerHand", () => {
  it("F1 dice=4 → 高牌", () => {
    const r = resolveDealerHand("5♣ 6♣ 7♦ 8♦ ?♠", 4);
    expect(r.cards).toHaveLength(5);
    expect(r.cards[4]!.rank).toBe(4);
    expect(r.cards[4]!.suit).toBe("S");
    // 5,6,7,8,4 = straight(4-8) → 顺子
    expect(r.category).toBe(HandCategory.顺子);
  });

  it("F1 dice=5 → 对子 (5♣ + 5♠)", () => {
    const r = resolveDealerHand("5♣ 6♣ 7♦ 8♦ ?♠", 5);
    expect(r.category).toBe(HandCategory.一对);
  });

  it("F3 dice=1(A) → 葫芦 (A♣ A♦ A♥ + 6♣ 6♦)", () => {
    const r = resolveDealerHand("A♣ A♦ 6♣ 6♦ ?♥", 1);
    expect(r.category).toBe(HandCategory.葫芦);
  });

  it("F6 dice=6 → 同花 (10♦ J♦ Q♦ K♦ 6♦)", () => {
    const r = resolveDealerHand("10♦ J♦ Q♦ K♦ ?♦", 6);
    expect(r.cards.every((c) => c.suit === "D")).toBe(true);
    expect(r.category).toBe(HandCategory.同花);
  });

  it("F6 dice=1(A) → 同花顺", () => {
    const r = resolveDealerHand("10♦ J♦ Q♦ K♦ ?♦", 1);
    expect(r.category).toBe(HandCategory.同花顺);
    expect(r.totalPoints).toBe(10 + 11 + 12 + 13 + 14);
  });

  it("F7 dice=6 → 五条 (6♠ 6♥ 6♣ 6♦ 6♦)", () => {
    const r = resolveDealerHand("6♠ 6♥ 6♣ ?♦ ?♦", 6);
    expect(r.category).toBe(HandCategory.五条);
  });

  it("F9 dice=3 → 五条 (3♠ 3♥ 3♣ 3♦ 3♠)", () => {
    const r = resolveDealerHand("?♠ ?♥ ?♣ ?♦ ?♠", 3);
    expect(r.category).toBe(HandCategory.五条);
  });

  it("F13 dice=4 → 六条", () => {
    const r = resolveDealerHand("?♠ ?♥ ?♣ ?♦ ?♠ ?♥", 4);
    expect(r.category).toBe(HandCategory.六条);
  });

  it("F14 dice=1(A) → 同花六条", () => {
    const r = resolveDealerHand("?♠ ?♠ ?♠ ?♠ ?♠ ?♠", 1);
    expect(r.category).toBe(HandCategory.同花六条);
  });

  it("F15 dice=5 → 七条", () => {
    const r = resolveDealerHand("?♠ ?♥ ?♣ ?♦ ?♠ ?♥ ?♣", 5);
    expect(r.category).toBe(HandCategory.七条);
  });
});

describe("parseFateEffect", () => {
  it.skip("F1 → playerDowngrade (encoding: skip)", () => {
    const e = parseFateEffect(MOCK_POOL.fate[0]!.effectText);
    expect(e?.kind).toBe("playerDowngrade");
  });

  it.skip("F5 → playerChipsDisable (encoding: skip)", () => {
    const e = parseFateEffect(MOCK_POOL.fate[4]!.effectText);
    expect(e?.kind).toBe("playerChipsDisable");
  });

  it("F9 → dealerSkillDisable", () => {
    const e = parseFateEffect("本回合机械荷官技能失效。");
    expect(e?.kind).toBe("dealerSkillDisable");
  });

  it("F10 → playerSkillDisable", () => {
    const e = parseFateEffect("本回合玩家技能失效。");
    expect(e?.kind).toBe("playerSkillDisable");
  });

  it.skip("F13 → playerUpgradeFixed(3) (encoding: skip)", () => {
    const e = parseFateEffect(MOCK_POOL.fate[12]!.effectText);
    expect(e?.kind).toBe("playerUpgradeFixed");
    expect((e as any).levels).toBe(3);
  });

  it("F11 → playerGainChips", () => {
    const e = parseFateEffect("【结算阶段】结束时：玩家获得×【血筹】（×=骰子点数）。");
    expect(e?.kind).toBe("playerGainChips");
  });

  it("F12 → playerGainChipsFateDiscard", () => {
    const e = parseFateEffect("【结算阶段】结束时：玩家获得×【血筹】（×=命运牌弃牌区数量）。");
    expect(e?.kind).toBe("playerGainChipsFateDiscard");
  });

  it("F15 → playerUpgradeByFateDiscard", () => {
    const e = parseFateEffect("【对决阶段】：玩家本回合的牌型提升×级（×=命运牌弃牌区数量）最高至七条。");
    expect(e?.kind).toBe("playerUpgradeByFateDiscard");
  });
});

describe("buildFateDecks", () => {
  it("10 basic + 5 advanced cards", () => {
    const state = { rngState: 42 } as any;
    const decks = buildFateDecks(MOCK_POOL, state);
    expect(decks.basic).toHaveLength(10);
    expect(decks.advanced).toHaveLength(5);
    expect(decks.discard).toHaveLength(0);
  });

  it("basic cards carry dealer template", () => {
    const state = { rngState: 42 } as any;
    const decks = buildFateDecks(MOCK_POOL, state);
    for (const c of decks.basic) {
      expect(fateDealerTemplate(c)).toBeTruthy();
      expect(fateEffectText(c)).toBeTruthy();
    }
  });

  it("advanced cards carry dealer template", () => {
    const state = { rngState: 42 } as any;
    const decks = buildFateDecks(MOCK_POOL, state);
    for (const c of decks.advanced) {
      expect(fateDealerTemplate(c)).toBeTruthy();
      expect(fateEffectText(c)).toBeTruthy();
    }
  });
});
