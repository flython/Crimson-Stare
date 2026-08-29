/**
 * 游戏配置加载（票据 07）。
 * 配置文件路径由 CONFIG_PATH 环境变量指定（compose 中挂载 /app/config/game-config.json），
 * 缺失字段回退到内置默认值；本地开发无配置文件时直接用默认值。
 * 数值含义见 config/game-config.json 内注释与 spec。
 */
import { readFileSync } from "node:fs";

export interface RankReward {
  rank: number;
  tickets: number;
  chips: number;
}

export interface GameConfig {
  /** 排名奖励：玩家人数(含单人模式荷官方按 2 人局) → 名次 → 车票/血筹 */
  rankRewards: Record<string, RankReward[]>;
  /** 目标车票：按玩家人数 */
  ticketGoals: Record<string, number>;
  handLimit: number;
  swapCount: number;
  swapCountWithPass: number;
  initialSwapTokens: { passHolder: number; others: number };
  deleteFreePerRound: number;
  deleteChipCost: number;
  reshuffleOrChips: number;
  blackMarketSlots: number;
  blackMarketBonusSlots: number[];
  blackMarketBonusChips: number;
  autoPassTimeoutSec: number;
}

const DEFAULT_CONFIG: GameConfig = {
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
};

export function loadGameConfig(path?: string): GameConfig {
  if (!path) return DEFAULT_CONFIG;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<GameConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch (err) {
    console.warn(`[config] 配置文件 ${path} 读取失败，使用默认配置:`, (err as Error).message);
    return DEFAULT_CONFIG;
  }
}
