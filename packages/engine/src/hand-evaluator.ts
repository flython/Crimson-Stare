/**
 * 牌型判定与 JOKER 赋值求解器（票据 03；票据 20 增加芯片声明视图）。
 *
 * 输入：出牌区的牌（默认 5 张；规则效果可能更多；"手牌不足 5 张出全部"时更少）。
 * 输出：单一最大牌型（金科玉律 5：只取单一最大牌型，同花顺不计为同花）与总点数。
 *
 * 牌型等级（规则书 7 节牌型表，从高到低）：
 *   七条 > 同花六条 > 六条 > 同花五条 > 同花葫芦 > 同花顺 > 五条 > 四条
 *   > 葫芦 > 同花 > 顺子 > 三条 > 两对 > 一对 > 高牌
 *
 * JOKER 求解策略：枚举每个 JOKER 的点数（2-14）与花色（4 种）赋值，
 * 取 (牌型等级, 总点数) 字典序最大的赋值。2 个 JOKER 时搜索空间 ≤ 52²，代价可忽略。
 *
 * 同分裁决（总点数仍相同时按特权证距离）不在此模块——那是引擎层的裁决，
 * 本模块只保证输出可比较的 (牌型等级, 总点数)。
 */
import { Card, SUITS, Suit } from "./cards.js";

/** 牌型等级，数值越大越强。 */
export enum HandCategory {
  高牌 = 1,
  一对 = 2,
  两对 = 3,
  三条 = 4,
  顺子 = 5,
  同花 = 6,
  葫芦 = 7,
  四条 = 8,
  同花顺 = 9,
  五条 = 10,
  同花葫芦 = 11,
  同花五条 = 12,
  六条 = 13,
  同花六条 = 14,
  七条 = 15,
}

export const HAND_CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.高牌]: "高牌",
  [HandCategory.一对]: "一对",
  [HandCategory.两对]: "两对",
  [HandCategory.三条]: "三条",
  [HandCategory.顺子]: "顺子",
  [HandCategory.同花]: "同花",
  [HandCategory.葫芦]: "葫芦",
  [HandCategory.四条]: "四条",
  [HandCategory.同花顺]: "同花顺",
  [HandCategory.五条]: "五条",
  [HandCategory.同花葫芦]: "同花葫芦",
  [HandCategory.同花五条]: "同花五条",
  [HandCategory.六条]: "六条",
  [HandCategory.同花六条]: "同花六条",
  [HandCategory.七条]: "七条",
};

/** 赋值完成后的牌面（点数与花色均已确定）。 */
export interface ResolvedCard {
  id: string;
  rank: number;
  suit: Suit;
  /** 该牌原本是 JOKER（展示层需要知道哪些是赋值出来的） */
  wasJoker: boolean;
}

export interface HandEvaluation {
  category: HandCategory;
  /** 出牌区所有牌点数之和（同牌型时的第一比较项） */
  totalPoints: number;
  /** 求解出最大牌型时的 JOKER 赋值结果 */
  cards: ResolvedCard[];
}

interface RawEvaluation {
  category: HandCategory;
  totalPoints: number;
}

/**
 * 判定一组已确定牌面的牌。
 * 约束：5 张 → 全部 5 张牌型；6/7 张 → 仅认六条/同花六条/七条家族
 *（更大的同张数集合必然覆盖更小的最优 5 张组合，故 5 张组合按 5 张子集枚举）；
 * 少于 5 张（手牌不足出全部）→ 仅按重复结构判定（无顺子/同花）。
 */
function classifyResolved(cards: { rank: number; suit: Suit }[]): RawEvaluation | null {
  const n = cards.length;
  if (n === 0) return null;

  const rankCounts = new Map<number, number>();
  const suitRankCounts = new Map<string, number>(); // `${suit}:${rank}` → 数量
  let totalPoints = 0;
  let allSameSuit = true;
  const firstSuit = cards[0]!.suit;

  for (const c of cards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    const key = `${c.suit}:${c.rank}`;
    suitRankCounts.set(key, (suitRankCounts.get(key) ?? 0) + 1);
    totalPoints += c.rank;
    if (c.suit !== firstSuit) allSameSuit = false;
  }

  const maxDup = Math.max(...rankCounts.values());
  const maxSuitDup = Math.max(...suitRankCounts.values());
  const distinctRanks = rankCounts.size;

  // 六/七条家族（仅当集合大小足够）
  if (n >= 7 && maxDup >= 7) return { category: HandCategory.七条, totalPoints };
  if (n >= 6 && maxDup >= 6) {
    return {
      category: maxSuitDup >= 6 ? HandCategory.同花六条 : HandCategory.六条,
      totalPoints,
    };
  }

  if (n === 5) {
    // 五条家族
    if (maxDup === 5) {
      return {
        category: maxSuitDup >= 5 ? HandCategory.同花五条 : HandCategory.五条,
        totalPoints,
      };
    }
    const isFlush = allSameSuit;
    const ranks = [...rankCounts.keys()].sort((a, b) => a - b);
    const isStraight = distinctRanks === 5 && ranks[4]! - ranks[0]! === 4;
    if (isFlush && isStraight) return { category: HandCategory.同花顺, totalPoints };
    if (maxDup === 4) return { category: HandCategory.四条, totalPoints };
    // 葫芦：3+2 结构（5 张恰有 2 个不同点数且存在 3 张）
    if (distinctRanks === 2 && maxDup === 3) {
      return {
        category: isFlush ? HandCategory.同花葫芦 : HandCategory.葫芦,
        totalPoints,
      };
    }
    if (isFlush) return { category: HandCategory.同花, totalPoints };
    if (isStraight) return { category: HandCategory.顺子, totalPoints };
    if (maxDup === 3) return { category: HandCategory.三条, totalPoints };
    if (distinctRanks === 3 && maxDup === 2) return { category: HandCategory.两对, totalPoints };
    if (maxDup === 2) return { category: HandCategory.一对, totalPoints };
    return { category: HandCategory.高牌, totalPoints };
  }

  // 少于 5 张：仅按重复结构（手牌不足时"出全部"的场景）
  if (n < 5) {
    if (maxDup === 4) return { category: HandCategory.四条, totalPoints };
    if (maxDup === 3) return { category: HandCategory.三条, totalPoints };
    if (distinctRanks === 2 && maxDup === 2) return { category: HandCategory.两对, totalPoints };
    if (maxDup === 2) return { category: HandCategory.一对, totalPoints };
    return { category: HandCategory.高牌, totalPoints };
  }

  // 5 < n 且不含 6/7 条 → 该子集不贡献独立牌型（其价值已由 5 张子集覆盖）
  return null;
}

/** 枚举数组所有大小为 k 的子集下标。 */
function* subsets(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield [...idx];
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}

/** 对不含 JOKER 的牌列表求单一最大牌型（供 JOKER 求解与测试复用）。 */
export function evaluateResolved(cards: { rank: number; suit: Suit }[]): RawEvaluation | null {
  const n = cards.length;
  if (n === 0) return null;

  if (n < 5) return classifyResolved(cards);
  if (n === 5) return classifyResolved(cards);

  // n > 5：枚举全部 5 张子集 + 整组判六/七条家族
  let best: RawEvaluation | null = null;
  const consider = (r: RawEvaluation | null) => {
    if (r && (!best || r.category > best.category)) best = r;
  };
  consider(classifyResolved(cards)); // 整组：可能是六条/七条家族
  for (const idx of subsets(n, 5)) {
    consider(classifyResolved(idx.map((i) => cards[i]!)));
  }
  return best;
}

/**
 * 芯片声明视图（票据 20）：牌型判定时生效的芯片效果。
 *
 * 声明值由出牌阶段交互确定（票据 22 落库），判定器只消费，不负责交互。
 * JOKER 不可插芯片（金科玉律），故视图对 JOKER 无效。
 */
export interface ChipView {
  /** 改花色类芯片（如变色墨水）：cardId → 判定时视为的花色 */
  suitOverride?: Record<string, Suit>;
  /** 双生镜片等"该牌视为 2 张"：参与判定时复制一份同点数同花色 */
  duplicate?: string[];
}

/** 应用芯片视图：改花色 / 复制牌（复制品 id 加 #dup 后缀以便展示层识别） */
function applyChipView(cards: Card[], view?: ChipView): Card[] {
  if (!view) return cards;
  const dup = new Set(view.duplicate ?? []);
  const out: Card[] = [];
  for (const c of cards) {
    const eff: Card = { ...c, suit: view.suitOverride?.[c.id] ?? c.suit };
    out.push(eff);
    if (dup.has(c.id)) out.push({ ...eff, id: `${c.id}#dup` });
  }
  return out;
}

/**
 * 主入口：判定出牌区的牌（可含 JOKER），返回单一最大牌型。
 * 牌数下限 1（手牌不足时出全部），上限 7（六条/七条为规则明示的合法造出牌型）。
 * chipView 为芯片声明视图（票据 20），缺省即票据 03 的原行为。
 */
export function evaluateHand(input: Card[], chipView?: ChipView): HandEvaluation {
  const cards = applyChipView(input, chipView);
  if (input.length === 0) throw new Error("出牌区不能为空");
  if (cards.length > 7) throw new Error("出牌区最多 7 张牌（含芯片复制）");

  const jokers = cards.filter((c) => c.isJoker);
  const plain = cards.filter((c) => !c.isJoker);

  // 无 JOKER：直接判定
  if (jokers.length === 0) {
    const raw = evaluateResolved(plain.map((c) => ({ rank: c.rank!, suit: c.suit! })));
    if (!raw) throw new Error("无法判定牌型");
    return {
      category: raw.category,
      totalPoints: raw.totalPoints,
      cards: cards.map((c) => ({ id: c.id, rank: c.rank!, suit: c.suit!, wasJoker: false })),
    };
  }

  // 枚举 JOKER 赋值，取 (牌型, 总点数) 字典序最大
  // 用对象引用规避 TS 闭包赋值导致的 never 收窄问题
  const best: { value: { raw: RawEvaluation; resolved: ResolvedCard[] } | null } = { value: null };

  const assign = (jokerIdx: number, current: { rank: number; suit: Suit }[]) => {
    if (jokerIdx === jokers.length) {
      const raw = evaluateResolved(current);
      if (!raw) return;
      const better =
        !best.value ||
        raw.category > best.value.raw.category ||
        (raw.category === best.value.raw.category && raw.totalPoints > best.value.raw.totalPoints);
      if (better) {
        let j = 0;
        const resolved = cards.map((c) =>
          c.isJoker
            ? { id: c.id, rank: current[plain.length + j]!.rank, suit: current[plain.length + j++]!.suit, wasJoker: true }
            : { id: c.id, rank: c.rank!, suit: c.suit!, wasJoker: false },
        );
        best.value = { raw, resolved };
      }
      return;
    }
    for (const rank of Array.from({ length: 13 }, (_, i) => i + 2)) {
      for (const suit of SUITS) {
        current.push({ rank, suit });
        assign(jokerIdx + 1, current);
        current.pop();
      }
    }
  };

  assign(0, plain.map((c) => ({ rank: c.rank!, suit: c.suit! })));

  if (!best.value) throw new Error("JOKER 求解失败");
  return { category: best.value.raw.category, totalPoints: best.value.raw.totalPoints, cards: best.value.resolved };
}

/** 比较两手牌：返回正数表示 a 胜，负数表示 b 胜，0 表示需要特权证距离裁决。 */
export function compareHands(a: HandEvaluation, b: HandEvaluation): number {
  if (a.category !== b.category) return a.category - b.category;
  return a.totalPoints - b.totalPoints;
}
