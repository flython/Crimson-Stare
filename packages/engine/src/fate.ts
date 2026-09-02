/**
 * 票据 32 — 单人模式命运牌库与荷官牌型。
 */
import type { Card, Suit } from "./cards.js";
import { card as mkCard } from "./cards.js";
import { evaluateHand, HandCategory } from "./hand-evaluator.js";
import type { GameState, FateDeckState } from "./core/state.js";
import type { CardPool, CardDef } from "./cardPool.js";

const SUIT_MAP: Record<string, Suit> = {
  "♠": "S", "♣": "C", "♥": "H", "♦": "D",
  S: "S", C: "C", H: "H", D: "D",
};

const RANK_MAP: Record<string, number> = {
  A: 14, J: 11, Q: 12, K: 13,
  "1": 14, "2": 2, "3": 3, "4": 4, "5": 5,
  "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
};

interface ParsedSlot {
  isWild: boolean;
  rank: number | null;
  suit: Suit;
}

export function resolveDealerHand(dealerHandTemplate: string, diceValue: number): {
  cards: Card[];
  category: HandCategory;
  totalPoints: number;
} {
  const tokens = dealerHandTemplate.trim().split(/\s+/);
  const slots: ParsedSlot[] = [];
  const fixedSuits: Suit[] = [];
  for (const token of tokens) {
    if (token.startsWith("?")) {
      const suitChar = token.slice(1);
      if (suitChar) fixedSuits.push(SUIT_MAP[suitChar]!);
    } else {
      fixedSuits.push(SUIT_MAP[token.slice(-1)]!);
    }
  }
  let suitIdx = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!.trim();
    if (token === "?") {
      let wildSuit: Suit;
      if (i > 0) {
        const prevToken = tokens[i - 1]!.trim();
        const prevSuitChar = prevToken.startsWith("?") ? prevToken.slice(1) : prevToken.slice(-1);
        wildSuit = SUIT_MAP[prevSuitChar]!;
      } else {
        wildSuit = fixedSuits[suitIdx++]!;
      }
      slots.push({ isWild: true, rank: null, suit: wildSuit });
    } else if (token.startsWith("?")) {
      const suitChar = token.slice(1);
      const suit = SUIT_MAP[suitChar];
      if (!suit) throw new Error("Unknown suit: " + suitChar);
      slots.push({ isWild: true, rank: null, suit });
    } else {
      const suitChar = token.slice(-1);
      const rankStr = token.slice(0, -1);
      const suit = SUIT_MAP[suitChar];
      if (!suit) throw new Error("Unknown suit: " + suitChar);
      const rank = RANK_MAP[rankStr];
      if (rank === undefined) throw new Error("Unknown rank: " + rankStr);
      slots.push({ isWild: false, rank, suit });
    }
  }
  const wildRank = diceValue === 1 ? 14 : diceValue;
  const cards: Card[] = slots.map((slot, idx) => {
    if (slot.isWild) {
      return mkCard(wildRank, slot.suit, "dealer-wild-" + idx);
    }
    return mkCard(slot.rank!, slot.suit, "dealer-fixed-" + idx);
  });
  const ev = evaluateHand(cards);
  return { cards, category: ev.category, totalPoints: ev.totalPoints };
}

export function getFateCardDef(pool: CardPool, defId: string): CardDef | undefined {
  return pool.fate.find((c) => c.id === defId);
}

type FateCard = Card & { _fateDefId: string; _dealerHandTemplate: string; _effectText: string };

export function buildFateDecks(pool: CardPool, state: Pick<GameState, "rngState">): FateDeckState {
  const basicDefs = pool.fate.filter((c) => c.subtype === "基础");
  const advancedDefs = pool.fate.filter((c) => c.subtype === "高级");
  if (basicDefs.length !== 10) throw new Error("Fate basic should have 10 cards, got " + basicDefs.length);
  if (advancedDefs.length !== 5) throw new Error("Fate advanced should have 5 cards, got " + advancedDefs.length);
  const basicCards = basicDefs.map((def, i) => ({
    rank: null, suit: null, isJoker: false,
    id: "fate-basic-" + i,
    _fateDefId: def.id,
    _dealerHandTemplate: def.fateData?.dealerHand ?? "",
    _effectText: def.effectText,
  } as FateCard));
  const advancedCards = advancedDefs.map((def, i) => ({
    rank: null, suit: null, isJoker: false,
    id: "fate-advanced-" + i,
    _fateDefId: def.id,
    _dealerHandTemplate: def.fateData?.dealerHand ?? "",
    _effectText: def.effectText,
  } as FateCard));
  return {
    basic: shuffleFate(state, basicCards) as unknown as Card[],
    advanced: shuffleFate(state, advancedCards) as unknown as Card[],
    discard: [],
  };
}

function shuffleFate<T>(state: Pick<GameState, "rngState">, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const s = state.rngState;
    state.rngState = (s + 0x6d2b79f5) >>> 0;
    let t = (s ^ (s >>> 15)) >>> 0;
    t = (t * (1 | s)) >>> 0;
    t = (t + (t << 3)) >>> 0;
    t ^= (t >> 1) >>> 0;
    t = ((t ^ ((t + (t << 2)) >>> 0) >> 3)) >>> 0;
    const k = (((t ^ (t >> 28)) >>> 0) * 0x2c1b3c6d) >>> 0;
    const j = (k >>> 0) % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function fateCardDefId(c: Card): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (c as any)._fateDefId ?? c.id;
}

type FateCard2 = Card & { _fateDefId: string; _dealerHandTemplate: string; _effectText: string };

function isFateCard2(c: Card): c is FateCard2 {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return "_dealerHandTemplate" in c;
}

export function fateDealerTemplate(c: Card): string {
  if (isFateCard2(c)) return c._dealerHandTemplate;
  return "";
}

export function fateEffectText(c: Card): string {
  if (isFateCard2(c)) return c._effectText;
  return "";
}

export type FateEffectType =
  | { kind: "playerDowngrade"; diceMultiplier: number }
  | { kind: "playerUpgrade"; diceMultiplier: number }
  | { kind: "playerUpgradeFixed"; levels: 3 }
  | { kind: "playerSkillDisable" }
  | { kind: "dealerSkillDisable" }
  | { kind: "playerChipsDisable" }
  | { kind: "playerForceDraw" }
  | { kind: "playerGainChips"; diceMultiplier: number }
  | { kind: "playerLoseChips"; diceMultiplier: number }
  | { kind: "playerGainChipsFateDiscard"; multiplier: number }
  | { kind: "playerDeleteChipCard" }
  | { kind: "playerKeepSmallest" }
  | { kind: "dealerGainPass" }
  | { kind: "playerUpgradeByFateDiscard"; multiplier: number };

export function parseFateEffect(effectText: string): FateEffectType | null {
  const t = effectText;
  if (t.includes("玩家牌型下降×级")) return { kind: "playerDowngrade", diceMultiplier: 1 };
  if (t.includes("玩家牌型提升×级（×=骰子点数）最高至七条"))
    return { kind: "playerUpgrade", diceMultiplier: 1 };
  if (t.includes("玩家牌型提升3级")) return { kind: "playerUpgradeFixed", levels: 3 };
  if (t.includes("玩家技能失效")) return { kind: "playerSkillDisable" };
  if (t.includes("机械荷官技能失效")) return { kind: "dealerSkillDisable" };
  if (t.includes("强化芯片无效")) return { kind: "playerChipsDisable" };
  if (t.includes("强制抽1张牌")) return { kind: "playerForceDraw" };
  if (t.includes("玩家获得×【血筹】（×=骰子点数）")) return { kind: "playerGainChips", diceMultiplier: 1 };
  if (t.includes("玩家丢弃×【血筹】（×=骰子点数）")) return { kind: "playerLoseChips", diceMultiplier: 1 };
  if (t.includes("玩家获得×【血筹】（×=命运牌弃牌区数量）"))
    return { kind: "playerGainChipsFateDiscard", multiplier: 1 };
  if (t.includes("选择并删除1张本回合打出过的带[强化芯片]的牌"))
    return { kind: "playerDeleteChipCard" };
  if (t.includes("保留在出牌区，下回合少出1张牌")) return { kind: "playerKeepSmallest" };
  if (t.includes("机械荷官获得【特权证】")) return { kind: "dealerGainPass" };
  if (t.includes("玩家本回合的牌型提升×级（×=命运牌弃牌区数量）最高至七条"))
    return { kind: "playerUpgradeByFateDiscard", multiplier: 1 };
  return null;
}
