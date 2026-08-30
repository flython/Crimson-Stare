import { describe, expect, it } from "vitest";
import { card, joker, Suit } from "../src/cards.js";
import {
  compareHands,
  evaluateHand,
  HandCategory,
  HAND_CATEGORY_NAMES,
} from "../src/hand-evaluator.js";

const S = (r: number, id?: string) => card(r, "S", id);
const H = (r: number, id?: string) => card(r, "H", id);
const D = (r: number, id?: string) => card(r, "D", id);
const C = (r: number, id?: string) => card(r, "C", id);

describe("牌型判定", () => {
  it("覆盖规则书全部牌型等级顺序", () => {
    const order = [
      HandCategory.高牌,
      HandCategory.一对,
      HandCategory.两对,
      HandCategory.三条,
      HandCategory.顺子,
      HandCategory.同花,
      HandCategory.葫芦,
      HandCategory.四条,
      HandCategory.同花顺,
      HandCategory.五条,
      HandCategory.同花葫芦,
      HandCategory.同花五条,
      HandCategory.六条,
      HandCategory.同花六条,
      HandCategory.七条,
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i]! - order[i - 1]!).toBe(1);
      expect(HAND_CATEGORY_NAMES[order[i]!]).toBeTruthy();
    }
  });

  it("基础牌型：高牌 / 一对 / 两对 / 三条 / 顺子 / 同花", () => {
    expect(evaluateHand([S(2), H(5), D(9), C(11), H(14)]).category).toBe(HandCategory.高牌);
    expect(evaluateHand([S(2), H(2), D(9), C(11), H(14)]).category).toBe(HandCategory.一对);
    expect(evaluateHand([S(2), H(2), D(9), C(9), H(14)]).category).toBe(HandCategory.两对);
    expect(evaluateHand([S(2), H(2), D(2), C(11), H(14)]).category).toBe(HandCategory.三条);
    expect(evaluateHand([S(4), H(5), D(6), C(7), H(8)]).category).toBe(HandCategory.顺子);
    expect(evaluateHand([S(4), S(6), S(9), S(11), S(14)]).category).toBe(HandCategory.同花);
  });

  it("葫芦 vs 四条：单一最大牌型（四条优先于葫芦，且不计为三条）", () => {
    expect(evaluateHand([S(9), H(9), D(9), C(9), H(10)]).category).toBe(HandCategory.四条);
    expect(evaluateHand([S(9), H(9), D(9), C(10), H(10)]).category).toBe(HandCategory.葫芦);
  });

  it("顺子边界：最小 23456，最大 10JQKA，A 恒为 14 无 A2345 轮子", () => {
    expect(evaluateHand([S(2), H(3), D(4), C(5), H(6)]).category).toBe(HandCategory.顺子);
    expect(evaluateHand([S(10), H(11), D(12), C(13), H(14)]).category).toBe(HandCategory.顺子);
    // A2345 不是顺子（A=14）
    expect(evaluateHand([S(14), H(2), D(3), C(4), H(5)]).category).toBe(HandCategory.高牌);
  });

  it("同花顺优先于同花与顺子", () => {
    expect(evaluateHand([S(6), S(7), S(8), S(9), S(10)]).category).toBe(HandCategory.同花顺);
  });

  it("五条 / 同花五条 / 同花葫芦（造出的牌型）", () => {
    // 五张同点数同花色（芯片/技能改花色后可造出）
    expect(evaluateHand([card(9, "S"), card(9, "S"), card(9, "S"), card(9, "S"), card(9, "S")]).category).toBe(
      HandCategory.同花五条,
    );
    // 五张同点数但花色不全相同 → 普通五条
    expect(evaluateHand([S(9), H(9), D(9), C(9), H(9)]).category).toBe(HandCategory.五条);
    expect(evaluateHand([H(9), H(9), H(9), H(10), H(10)]).category).toBe(HandCategory.同花葫芦);
    expect(evaluateHand([S(9), H(9), D(9), H(10), H(10)]).category).toBe(HandCategory.葫芦);
  });

  it("六条 / 同花六条 / 七条（>5 张出牌）", () => {
    expect(evaluateHand([S(9), H(9), D(9), C(9), S(9), H(9)]).category).toBe(HandCategory.六条);
    expect(
      evaluateHand([card(9, "S"), card(9, "S"), card(9, "S"), card(9, "S"), card(9, "S"), card(9, "S")])
        .category,
    ).toBe(HandCategory.同花六条);
    expect(
      evaluateHand([
        card(9, "S"), card(9, "S"), card(9, "S"),
        card(9, "S"), card(9, "S"), card(9, "S"), card(9, "H"),
      ]).category,
    ).toBe(HandCategory.七条);
  });
});

describe("JOKER 求解", () => {
  it("规则书示例：特型演员 JOKER 视为 J 组成葫芦，总点数 39", () => {
    // 红桃2(JOKER改点)、黑桃J、草花J、红桃3、方片3 → 葫芦 11*3+3+3=39
    const hand = [joker("j1"), S(11, "sj"), C(11, "cj"), H(3, "h3"), D(3, "d3")];
    const ev = evaluateHand(hand);
    expect(ev.category).toBe(HandCategory.葫芦);
    expect(ev.totalPoints).toBe(39);
    const jokerResolved = ev.cards.find((c) => c.wasJoker)!;
    expect(jokerResolved.rank).toBe(11);
  });

  it("JOKER 优先找全局最大牌型：四条+JOKER → 五条", () => {
    const ev = evaluateHand([S(9), H(9), D(9), C(9), joker("j1")]);
    expect(ev.category).toBe(HandCategory.五条);
    expect(ev.totalPoints).toBe(45);
  });

  it("双 JOKER 补成同花顺", () => {
    const ev = evaluateHand([S(6), S(7), joker("j1"), joker("j2"), S(10)]);
    expect(ev.category).toBe(HandCategory.同花顺);
    expect(ev.totalPoints).toBe(40); // 6+7+8+9+10
  });

  it("双 JOKER 补成同花五条（高于同花顺）", () => {
    // 三张黑桃9 + 双JOKER赋值为9 → 五张同点同花
    const ev = evaluateHand([S(9), S(9), S(9), joker("j1"), joker("j2")]);
    expect(ev.category).toBe(HandCategory.同花五条);
    expect(ev.totalPoints).toBe(45);
  });
});

describe("总点数与比较", () => {
  it("规则书示例：矿工 46 点葫芦 vs 特型演员 39 点葫芦 → 矿工胜", () => {
    const miner = evaluateHand([S(10), C(10), joker("mj"), C(8), S(8)]); // JOKER视为黑桃10 → 10*3+8+8=46
    const actor = evaluateHand([joker("aj"), S(11), C(11), H(3), D(3)]); // 39
    expect(miner.category).toBe(HandCategory.葫芦);
    expect(miner.totalPoints).toBe(46);
    expect(compareHands(miner, actor)).toBeGreaterThan(0);
  });

  it("同牌型同点数返回 0（交由引擎按特权证距离裁决）", () => {
    const a = evaluateHand([S(2), H(2), D(5), C(9), H(14)]);
    const b = evaluateHand([D(2), C(2), H(5), S(9), D(14)]);
    expect(compareHands(a, b)).toBe(0);
  });

  it("高牌型直接胜出，无视总点数", () => {
    const gao = evaluateHand([S(2), H(5), D(9), C(11), H(14)]); // 高牌 41 点
    const hu = evaluateHand([S(3), H(3), D(3), C(4), H(4)]); // 葫芦 17 点
    expect(compareHands(hu, gao)).toBeGreaterThan(0);
  });
});

describe("手牌不足场景", () => {
  it("少于 5 张时按重复结构判定", () => {
    expect(evaluateHand([S(9), H(9), D(9), C(9)]).category).toBe(HandCategory.四条);
    expect(evaluateHand([S(9), H(9), D(9)]).category).toBe(HandCategory.三条);
    expect(evaluateHand([S(9), H(9)]).category).toBe(HandCategory.一对);
    expect(evaluateHand([S(9)]).category).toBe(HandCategory.高牌);
  });

  it("空出牌区抛错", () => {
    expect(() => evaluateHand([])).toThrow();
  });
});

// 引用避免未使用告警
void Suit;

// ===== 票据 20：芯片声明视图 =====
describe("芯片声明视图（票据 20）", () => {
  it("改花色芯片：把一张牌改花色后判定为同花", () => {
    const cards = [card(3, "S", "c1"), card(5, "S", "c2"), card(7, "S", "c3"), card(9, "S", "c4"), card(11, "H", "c5")];
    expect(evaluateHand(cards).category).toBe(HandCategory.高牌);
    const withChip = evaluateHand(cards, { suitOverride: { c5: "S" } });
    expect(withChip.category).toBe(HandCategory.同花);
    // 复制牌不改变原卡 id（复制品带 #dup）
    expect(withChip.cards.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("视为 2 张芯片：四条 + 复制 → 五条", () => {
    const cards = [card(7, "S", "d1"), card(7, "H", "d2"), card(7, "D", "d3"), card(7, "C", "d4")];
    expect(evaluateHand(cards).category).toBe(HandCategory.四条);
    const ev = evaluateHand(cards, { duplicate: ["d1"] });
    expect(ev.category).toBe(HandCategory.五条);
    expect(ev.cards.filter((c) => c.id === "d1#dup")).toHaveLength(1);
  });

  it("复制牌可造六条（6 张出牌 + 复制）", () => {
    const cards = [
      card(9, "S", "e1"),
      card(9, "H", "e2"),
      card(9, "D", "e3"),
      card(9, "C", "e4"),
      card(9, "S", "e5"),
      card(9, "H", "e6"),
    ];
    expect(evaluateHand(cards).category).toBe(HandCategory.六条);
    // 5 张 + 复制 1 张 = 6 张同点 → 六条
    const five = cards.slice(0, 5);
    expect(evaluateHand(five).category).toBe(HandCategory.五条);
    expect(evaluateHand(five, { duplicate: ["e1"] }).category).toBe(HandCategory.六条);
  });

  it("超上限（含复制）抛错，JOKER 不受芯片影响", () => {
    const cards = [card(2, "S", "f1"), card(3, "S", "f2"), card(4, "S", "f3"), card(5, "S", "f4"), card(6, "S", "f5"), card(7, "S", "f6"), card(8, "S", "f7")];
    expect(() => evaluateHand(cards, { duplicate: ["f1"] })).toThrow(/最多 7 张/);
    // JOKER 不可插芯片：改花色对 JOKER 无效（仍由求解器赋值）
    const withJoker = [joker("j1"), card(10, "S", "g2"), card(11, "S", "g3"), card(12, "S", "g4"), card(13, "S", "g5")];
    const ev = evaluateHand(withJoker, { suitOverride: { j1: "H" } });
    expect(ev.category).toBe(HandCategory.同花顺);
  });
});
