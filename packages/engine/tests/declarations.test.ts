/**
 * 票据 22 — 六/七条放宽 engine 单元测试（countSixSeven）。
 */
import { describe, it, expect } from "vitest";
import { countSixSeven } from "../src/hand-evaluator.js";
import type { Card } from "../src/cards.js";

function makeCard(id: string, suit: "S" | "H" | "D" | "C", rank: number): Card {
  return { id, suit, rank, isJoker: false };
}

describe("countSixSeven（票据 22 六/七条放宽）", () => {
  it("6张同点牌返回 six=1", () => {
    const cards: Card[] = Array.from({ length: 6 }, (_, i) =>
      makeCard(`card${i}`, "S", 7),
    );
    expect(countSixSeven(cards)).toEqual({ six: 1, seven: 0 });
  });

  it("7张同点牌返回 seven=1", () => {
    const cards: Card[] = Array.from({ length: 7 }, (_, i) =>
      makeCard(`card${i}`, "S", 10),
    );
    expect(countSixSeven(cards)).toEqual({ six: 0, seven: 1 });
  });

  it("普通5张返回 six=0 seven=0", () => {
    const cards = [
      makeCard("H7", "H", 7),
      makeCard("S8", "S", 8),
      makeCard("D9", "D", 9),
      makeCard("CK", "C", 13),
      makeCard("DA", "D", 14),
    ];
    expect(countSixSeven(cards)).toEqual({ six: 0, seven: 0 });
  });

  it("5张四条不算六条", () => {
    // 四条：4张同点 + 1张其他 → 不是六条（需要≥6张）
    const cards = [
      makeCard("H7", "H", 7),
      makeCard("S7", "S", 7),
      makeCard("D7", "D", 7),
      makeCard("C7", "C", 7),
      makeCard("DA", "D", 14),
    ];
    expect(countSixSeven(cards)).toEqual({ six: 0, seven: 0 });
  });
});
