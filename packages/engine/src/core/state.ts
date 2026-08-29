/**
 * 票据 02 — 引擎核心状态形状。
 *
 * 设计原则：
 * 1. GameState 完全可 JSON 序列化，服务端是唯一权威持有者；
 * 2. 私密信息（手牌/弃牌区/删牌区/抽牌堆）一律完整存于 state，对外通过 redact() 裁剪——
 *    服务端按连接逐个裁剪后下发，引擎本身不做隐藏（金科玉律 1/2 的执行点在 server 分发层）；
 * 3. RNG 状态内嵌于 state（rngState），重放 = 初始 seed + 有序 Action 流，无需快照。
 */
import type { Card } from "../cards.js";

/** 回合 8 阶段，按规则书顺序 */
export type PhaseId =
  | "draw"
  | "swap"
  | "play"
  | "duel"
  | "settle"
  | "purchase"
  | "delete"
  | "reshape";

export const PHASE_ORDER: readonly PhaseId[] = [
  "draw",
  "swap",
  "play",
  "duel",
  "settle",
  "purchase",
  "delete",
  "reshape",
] as const;

/** 单个玩家的全部区域（含黑市芯片挂载记录与道具区） */
export interface PlayerZones {
  /** 抽牌堆：对所有人不可见（含本人查看也走服务端） */
  draw: Card[];
  /** 手牌：仅本人可见 */
  hand: Card[];
  /** 弃牌区：仅本人可见（金科玉律 1） */
  discard: Card[];
  /** 出牌区：对决阶段亮出后对所有人可见 */
  play: Card[];
  /** 删牌区：移出游戏，仅本人可见 */
  deleted: Card[];
  /** 强化芯片：牌实例 id → 黑市牌 defId（每张牌限 1，不可替换） */
  chips: Record<string, string>;
  /** 道具区：备用道具 defId 列表（正面朝上，公开） */
  items: string[];
}

export interface PlayerState {
  id: string;
  name: string;
  /** 座位号 0..n-1，顺时针排列 */
  seat: number;
  /** 角色牌 defId，M2 前为 null（白板局） */
  characterId: string | null;
  /** 血筹（公开信息，金科玉律 12） */
  chips: number;
  tickets: number;
  /** 本回合剩余换牌次数 */
  swapLeft: number;
  /** 购买阶段是否已翻面（不可再购买） */
  purchaseFlipped: boolean;
  /** 当前阶段是否已完成个人操作（等待其他玩家） */
  phaseReady: boolean;
  zones: PlayerZones;
}

/** 黑市区一个栏位 */
export interface BlackMarketSlot {
  /** 黑市牌定义 id（数据管道票据 06 提供），空位为 null */
  defId: string | null;
  price: number;
  /** 叠加在牌上的血筹（购买阶段结束时最右两格各 +1） */
  bonusChips: number;
}

export interface BlackMarketState {
  slots: BlackMarketSlot[];
  /** 供应堆（背面朝上，洗混后的 defId+price 序列） */
  supply: { defId: string; price: number }[];
}

export interface LogEntry {
  turn: number;
  phase: PhaseId;
  text: string;
}

export interface GameState {
  players: PlayerState[]; // 按座位顺时针
  phase: PhaseId;
  turn: number; // 从 1 开始
  /** 临时特权证持有者座位；null 仅存在于开局分配前 */
  passHolderSeat: number | null;
  blackMarket: BlackMarketState;
  /** 事件牌（MVP 默认关闭，保留字段） */
  eventCardId: string | null;
  /** mulberry32 内部状态（32 位无符号），重放根 */
  rngState: number;
  log: LogEntry[];
  finished: boolean;
  /** 胜者 playerId 列表（平局可多人） */
  winners: string[];
}
