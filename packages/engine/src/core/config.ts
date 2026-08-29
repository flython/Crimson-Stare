/**
 * 票据 02 — 引擎层配置类型与默认值（单一事实源）。
 * server 端的 loadGameConfig 负责从 JSON 文件读入并合并到 DEFAULT_GAME_CONFIG；
 * reducer 一律只消费本类型，保证"奖励表可配置调平衡"贯穿引擎。
 */

export interface RankReward {
  rank: number;
  tickets: number;
  chips: number;
}

export interface GameConfig {
  /** 排名奖励：玩家人数 → 名次 → 车票/血筹（可配置调平衡的硬需求） */
  rankRewards: Record<string, RankReward[]>;
  /** 目标车票：玩家人数 → 目标 */
  ticketGoals: Record<string, number>;
  handLimit: number;
  swapCount: number;
  swapCountWithPass: number;
  initialSwapTokens: { passHolder: number; others: number };
  deleteFreePerRound: number;
  deleteChipCost: number;
  reshuffleOrChips: number;
  blackMarketSlots: number;
  /** 购买阶段结束时叠加血筹的栏位（1-based 序号） */
  blackMarketBonusSlots: number[];
  blackMarketBonusChips: number;
  autoPassTimeoutSec: number;
  /** 交互 prompt 超时（M2.4）：超过后按 timeoutPolicy 处理 */
  promptTimeoutSec: number;
  /** "auto"=超时自动默认选择（choosePlayer 随机/chooseCard 不选）；"strict"=永不自动（可能卡死，人工介入） */
  timeoutPolicy: "auto" | "strict";
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  rankRewards: {
    "2": [
      { rank: 1, tickets: 4, chips: 0 },
      { rank: 2, tickets: 0, chips: 4 },
    ],
    "3": [
      { rank: 1, tickets: 4, chips: 0 },
      { rank: 2, tickets: 2, chips: 2 },
      { rank: 3, tickets: 0, chips: 4 },
    ],
    "4": [
      { rank: 1, tickets: 4, chips: 0 },
      { rank: 2, tickets: 2, chips: 2 },
      { rank: 3, tickets: 1, chips: 3 },
      { rank: 4, tickets: 0, chips: 4 },
    ],
  },
  ticketGoals: { "2": 24, "3": 20, "4": 16 },
  handLimit: 6,
  swapCount: 3,
  swapCountWithPass: 4,
  initialSwapTokens: { passHolder: 2, others: 3 },
  deleteFreePerRound: 1,
  deleteChipCost: 2,
  reshuffleOrChips: 2,
  blackMarketSlots: 5,
  blackMarketBonusSlots: [4, 5],
  blackMarketBonusChips: 1,
  autoPassTimeoutSec: 120,
  promptTimeoutSec: 60,
  timeoutPolicy: "auto",
};
