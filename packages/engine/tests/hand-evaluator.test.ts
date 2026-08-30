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
    const withChip = evaluateHand(cards, { suitOptions: { c5: ["S"] } });
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
    const ev = evaluateHand(withJoker, { suitOptions: { j1: ["H"] } });
    expect(ev.category).toBe(HandCategory.同花顺);
  });
});

// ===== 票据 20：角色映射视图（可选点数 / 视为 JOKER）=====
describe("角色映射视图（票据 20）", () => {
  it("可选点数（2 视为 5）：两张 2 变 5 凑三条", () => {
    const cards = [card(2, "S", "r1"), card(2, "H", "r2"), card(5, "D", "r3"), card(7, "C", "r4"), card(9, "S", "r5")];
    expect(evaluateHand(cards).category).toBe(HandCategory.一对);
    const ev = evaluateHand(cards, { rankOptions: { r1: [2, 5], r2: [2, 5] } });
    expect(ev.category).toBe(HandCategory.三条);
    // 变为 5 后点数总和提高（7+9+5*3 = 31）
    expect(ev.totalPoints).toBe(31);
  });

  it("可选点数：牌型相同且原值点数更大时保留原值（9 可视为 6）", () => {
    const cards = [card(9, "S", "s1"), card(7, "H", "s2"), card(5, "D", "s3"), card(3, "C", "s4"), card(2, "S", "s5")];
    const ev = evaluateHand(cards, { rankOptions: { s1: [9, 6] } });
    expect(ev.category).toBe(HandCategory.高牌);
    expect(ev.cards.find((c) => c.id === "s1")!.rank).toBe(9);
  });

  it("可选点数：变 6 能凑四条时采用（9 可视为 6）", () => {
    const cards = [card(9, "S", "s6"), card(6, "H", "s7"), card(6, "D", "s8"), card(6, "C", "s9"), card(2, "S", "sa")];
    expect(evaluateHand(cards).category).toBe(HandCategory.三条);
    const ev = evaluateHand(cards, { rankOptions: { s6: [9, 6] } });
    expect(ev.category).toBe(HandCategory.四条);
    expect(ev.cards.find((c) => c.id === "s6")!.rank).toBe(6);
  });

  it("视为 JOKER（4 视为小丑）：自由牌补成四条", () => {
    const cards = [card(4, "S", "t1"), card(4, "H", "t2"), card(9, "S", "t3"), card(9, "H", "t4"), card(9, "D", "t5")];
    expect(evaluateHand(cards).category).toBe(HandCategory.葫芦);
    const ev = evaluateHand(cards, { asJoker: ["t1"] });
    expect(ev.category).toBe(HandCategory.四条); // 4♠ 视为小丑后赋为 9
    expect(ev.cards.find((c) => c.id === "t1")!.rank).toBe(9);
    expect(ev.cards.find((c) => c.id === "t1")!.wasJoker).toBe(true);
  });

  it("视为 JOKER 与真 JOKER 共存：两张自由牌一并求解", () => {
    const cards = [joker("u0"), card(9, "S", "u1"), card(9, "H", "u2"), card(4, "D", "u3"), card(4, "C", "u4")];
    const ev = evaluateHand(cards, { asJoker: ["u3"] });
    // 3 张 9（含赋值）+ 2 张 4 → 取五条：9 需要 3 张自由牌但只有 2 张 → 四条 9
    expect(ev.category).toBe(HandCategory.四条);
    expect(ev.cards.filter((c) => c.wasJoker)).toHaveLength(2);
  });

  it("复制牌与本体共享点数选择（双生镜片 + 点数映射→五条）", () => {
    const cards = [card(2, "S", "v1"), card(5, "H", "v2"), card(5, "D", "v3"), card(5, "C", "v4")];
    const ev = evaluateHand(cards, { duplicate: ["v1"], rankOptions: { v1: [2, 5] } });
    expect(ev.category).toBe(HandCategory.五条);
    expect(ev.cards.find((c) => c.id === "v1")!.rank).toBe(5);
    expect(ev.cards.find((c) => c.id === "v1#dup")!.rank).toBe(5);
  });

  it("自由牌 ≥4 走缩减向量枚举：全同值造同花五条", () => {
    const cards = [card(4, "S", "w1"), card(4, "H", "w2"), card(4, "D", "w3"), card(4, "C", "w4"), card(7, "H", "w5")];
    const ev = evaluateHand(cards, { asJoker: ["w1", "w2", "w3", "w4"] });
    expect(ev.category).toBe(HandCategory.同花五条); // 四张自由牌取固定牌的 7♥ → 5 张 7♥
    expect(ev.totalPoints).toBe(35);
    expect(ev.cards.filter((c) => c.wasJoker)).toHaveLength(4);
  });

  it("自由牌 ≥4 且无同点固定牌：取点数最大的 A", () => {
    const cards = [card(4, "S", "y1"), card(4, "H", "y2"), card(4, "D", "y3"), card(4, "C", "y4"), card(7, "H", "y5")];
    const ev = evaluateHand(cards, { asJoker: ["y1", "y2", "y3", "y4", "y5"] });
    expect(ev.category).toBe(HandCategory.同花五条); // 5 张自由牌全赋同值，取 A♠
    expect(ev.totalPoints).toBe(70);
  });
});
