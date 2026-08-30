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
 * 判定视图（票据 20）：牌型判定时生效的芯片/角色映射声明。
 *
 * 声明值由出牌阶段交互确定（票据 22 落库），判定器只消费，不负责交互。
 * JOKER 不可插芯片（金科玉律），故芯片类字段对 JOKER 无效；
 * rankOptions / asJoker 由角色技能提供（2 视为 5 / 6↔9 / 4 视为小丑）。
 */
export interface ChipView {
  /**
   * 候选花色：cardId → 可视为的花色集合（变色墨水 = 四花色全开、黑色芯片 = ♠♣、红色芯片 = ♦♥）。
   * 单元素数组即"改花色"；候选含原花色时"全部纳入"只会让结果更好或相等。
   */
  suitOptions?: Record<string, Suit[]>;
  /** 双生镜片等"该牌视为 2 张"：参与判定时复制一份同点数同花色 */
  duplicate?: string[];
  /** 可选点数：cardId → 候选点数（含原值），求解器枚举取最优（2 视为 5 / 6↔9 / 数字滑轨全点数） */
  rankOptions?: Record<string, number[]>;
  /** 视为 JOKER 参与求解（4 视为小丑 / 百变影像；由玩家在出牌时声明，票据 22 交互确定） */
  asJoker?: string[];
}

/** JOKER / 视为 JOKER 的牌可赋的全部 52 种（点数 2-14 × 4 花色） */
const ALL_ASSIGNMENTS: readonly { rank: number; suit: Suit }[] = SUITS.flatMap((suit) =>
  Array.from({ length: 13 }, (_, i) => ({ rank: i + 2, suit })),
);

/**
 * 判定视图下的一张牌：cands 长度 1 = 固定牌，>1 = 需枚举赋值的牌。
 * tieGroup：同一张牌的复制品与被复制牌共享选择（双生镜片 + 点数映射时点数须一致）。
 */
interface ViewedCard {
  id: string;
  wasJoker: boolean;
  cands: readonly { rank: number; suit: Suit }[];
  tieGroup?: string;
}

/**
 * 应用判定视图：候选花色 / 候选点数（笛卡尔积）/ 复制牌（复制品 id 加 #dup 后缀）/ 视为 JOKER。
 * 点数与花色候选同时存在时取笛卡尔积；两者全开等价 JOKER，由注册方直接用 asJoker 表示。
 */
function applyChipView(cards: Card[], view?: ChipView): ViewedCard[] {
  const dup = new Set(view?.duplicate ?? []);
  const asJoker = new Set(view?.asJoker ?? []);
  const out: ViewedCard[] = [];
  const push = (c: Card, isDup: boolean) => {
    const free = c.isJoker || asJoker.has(c.id);
    let cands: readonly { rank: number; suit: Suit }[];
    if (free) {
      cands = ALL_ASSIGNMENTS;
    } else {
      const ranks = view?.rankOptions?.[c.id] ?? [c.rank!];
      const suits = view?.suitOptions?.[c.id] ?? [c.suit!];
      cands = ranks.flatMap((rank) => suits.map((suit) => ({ rank, suit })));
    }
    out.push({
      id: isDup ? `${c.id}#dup` : c.id,
      wasJoker: free,
      cands,
      tieGroup: dup.has(c.id) ? c.id : undefined,
    });
  };
  for (const c of cards) {
    push(c, false);
    if (dup.has(c.id)) push(c, true);
  }
  return out;
}

/** 组合数上限：超过则改用缩减向量枚举，避免自由牌过多（4 张以上视为 JOKER）时组合爆炸 */
const MAX_COMBOS = 200_000;

/** evaluateResolved 记忆化（牌序无关，按排序签名缓存；自由牌枚举重复度极高） */
const memo = new Map<string, RawEvaluation | null>();

function evalMemo(vals: readonly { rank: number; suit: Suit }[]): RawEvaluation | null {
  const key = vals
    .map((v) => `${v.rank}${v.suit}`)
    .sort()
    .join(",");
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  if (memo.size > 100_000) memo.clear();
  const r = evaluateResolved(vals as { rank: number; suit: Suit }[]);
  memo.set(key, r);
  return r;
}

function isBetter(a: RawEvaluation, b: RawEvaluation | null): boolean {
  return !b || a.category > b.category || (a.category === b.category && a.totalPoints > b.totalPoints);
}

/**
 * 降级候选向量（自由牌 ≥4 时使用）：只枚举"全部自由牌取同一赋值"。
 *
 * 充分性：设自由牌 f ≥ 4、固定牌 m。全同值 X 使同点张数 ≥ f ≥ 4（至少四条）；
 * 若 X 命中固定牌的点数则 ≥ 五条/同花五条(10/12)。任何非全同值方案的最好牌型是同花顺(9)，
 * 劣于五条；f=4 且 m=0 时全同值即四条(8)，此时牌数不足 5，顺子/同花本就不成立。
 * 值池 = 固定牌的 (点数, 花色) ∪ A×4：前者保证能凑同花五条，后者保证同牌型下点数最大。
 */
function fallbackVectors(fixedVals: readonly { rank: number; suit: Suit }[], n: number): { rank: number; suit: Suit }[][] {
  const pool: { rank: number; suit: Suit }[] = [];
  const seen = new Set<string>();
  const add = (v: { rank: number; suit: Suit }) => {
    const k = `${v.rank}${v.suit}`;
    if (!seen.has(k)) {
      seen.add(k);
      pool.push(v);
    }
  };
  for (const v of fixedVals) add(v);
  for (const suit of SUITS) add({ rank: 14, suit }); // A：同牌型下点数最大
  return pool.map((v) => Array.from({ length: n }, () => v));
}

/** 求解：枚举全部候选赋值，取 (牌型, 总点数) 字典序最大 */
function solve(cards: ViewedCard[]): { raw: RawEvaluation; resolved: ResolvedCard[] } | null {
  let combos = 1;
  const tied = new Set<string>();
  for (const c of cards) {
    if (c.tieGroup) {
      if (tied.has(c.tieGroup)) continue;
      tied.add(c.tieGroup);
    }
    combos *= c.cands.length;
  }

  const best: { value: { raw: RawEvaluation; resolved: ResolvedCard[] } | null } = { value: null };
  const consider = (vals: { rank: number; suit: Suit }[]) => {
    const raw = evalMemo(vals);
    if (raw && isBetter(raw, best.value?.raw ?? null)) {
      best.value = {
        raw,
        resolved: cards.map((c, i) => ({ id: c.id, rank: vals[i]!.rank, suit: vals[i]!.suit, wasJoker: c.wasJoker })),
      };
    }
  };

  if (combos <= MAX_COMBOS) {
    const chosen = new Map<string, number>();
    const current: { rank: number; suit: Suit }[] = [];
    const rec = (i: number) => {
      if (i === cards.length) {
        consider(current);
        return;
      }
      const c = cards[i]!;
      const tie = c.tieGroup ? chosen.get(c.tieGroup) : undefined;
      if (tie !== undefined) {
        current.push(c.cands[tie]!);
        rec(i + 1);
        current.pop();
        return;
      }
      for (let k = 0; k < c.cands.length; k++) {
        if (c.tieGroup) chosen.set(c.tieGroup, k);
        current.push(c.cands[k]!);
        rec(i + 1);
        current.pop();
      }
      if (c.tieGroup) chosen.delete(c.tieGroup);
    };
    rec(0);
    return best.value;
  }

  // 降级：把自由牌按 tieGroup 归并成"槽"，用缩减向量枚举
  const slots: number[][] = [];
  const groups = new Map<string, number[]>();
  for (let i = 0; i < cards.length; i++) {
    if (cards[i]!.cands.length === 1) continue;
    const g = cards[i]!.tieGroup;
    if (g) {
      const arr = groups.get(g) ?? [];
      arr.push(i);
      groups.set(g, arr);
    } else {
      slots.push([i]);
    }
  }
  for (const arr of groups.values()) slots.push(arr);
  const fixedVals = cards.filter((c) => c.cands.length === 1).map((c) => c.cands[0]!);
  for (const vec of fallbackVectors(fixedVals, slots.length)) {
    const vals = cards.map((c) => c.cands[0]!);
    slots.forEach((positions, k) => {
      for (const pos of positions) vals[pos] = vec[k]!;
    });
    consider(vals);
  }
  return best.value;
}

/**
 * 主入口：判定出牌区的牌（可含 JOKER），返回单一最大牌型。
 * 牌数下限 1（手牌不足时出全部），上限 7（六条/七条为规则明示的合法造出牌型）。
 * chipView 为判定视图（票据 20），缺省即票据 03 的原行为。
 */
export function evaluateHand(input: Card[], chipView?: ChipView): HandEvaluation {
  if (input.length === 0) throw new Error("出牌区不能为空");
  const cards = applyChipView(input, chipView);
  if (cards.length > 7) throw new Error("出牌区最多 7 张牌（含芯片复制）");
  const best = solve(cards);
  if (!best) throw new Error("无法判定牌型");
  return { category: best.raw.category, totalPoints: best.raw.totalPoints, cards: best.resolved };
}

/** 比较两手牌：返回正数表示 a 胜，负数表示 b 胜，0 表示需要特权证距离裁决。 */
export function compareHands(a: HandEvaluation, b: HandEvaluation): number {
  if (a.category !== b.category) return a.category - b.category;
  return a.totalPoints - b.totalPoints;
}

/**
 * 统计手牌中可造六条/七条的数量（票据 22 六/七条放宽）。
 * 枚举全部非空子集，找出满足六条(≥6张同点数)或七条(≥7张同点数)的最大集合。
 * 返回 `{ six, seven }`：可额外出超过 5 张的牌数量（seven=1 时 six=0）。
 * 用于 playCards 上限 = 5 + six（不超过手牌张数）。
 */
export function countSixSeven(cards: Card[]): { six: number; seven: number } {
  let maxDup = 0;
  const rankCounts = new Map<number, number>();
  for (const c of cards) {
    if (c.isJoker) continue; // JOKER 不贡献固定点数
    const r = c.rank ?? 0;
    rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
    maxDup = Math.max(maxDup, rankCounts.get(r)!);
  }
  if (maxDup >= 7) return { six: 0, seven: 1 };
  if (maxDup >= 6) return { six: maxDup - 5, seven: 0 };
  return { six: 0, seven: 0 };
}
