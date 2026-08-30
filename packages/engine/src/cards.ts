/**
 * 牌面基础类型。
 * 约定：A 恒为 14 点（金科玉律）；点数合法范围 2-14（强化芯片改点后仍须落在该区间，
 * 越界拦截属于效果层职责，本模块不做校验）。
 */

/** 花色：黑桃 / 红桃 / 方片 / 草花 */
export type Suit = "S" | "H" | "D" | "C";

export const SUITS: readonly Suit[] = ["S", "H", "D", "C"] as const;

/** 牌堆中的一张牌（含实例 id，供引擎追踪）。 */
export interface Card {
  /** 点数 2-14；JOKER 在赋值前为 null；被强化芯片修改后保留原始值于 baseRank */
  rank: number | null;
  /** 花色；JOKER 在赋值前为 null */
  suit: Suit | null;
  /** 是否为 JOKER（大小王在判定上等价） */
  isJoker: boolean;
  /** 牌实例唯一 id */
  id: string;
  /**
   * 强化芯片插入前的原始点数（仅数值类芯片 001-007 会设置）。
   * 用于 UI 显示"修改后点数 (原始点数±芯片加值)"。
   */
  baseRank?: number | null;
}

/** 构造一张普通牌的便捷函数（测试与引擎共用）。 */
export function card(rank: number, suit: Suit, id?: string): Card {
  return { rank, suit, isJoker: false, id: id ?? `${suit}${rank}` };
}

/** 构造一张 JOKER。 */
export function joker(id?: string): Card {
  return { rank: null, suit: null, isJoker: true, id: id ?? `JOKER${id ?? ""}` };
}
