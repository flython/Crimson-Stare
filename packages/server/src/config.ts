/**
 * 游戏配置加载（票据 07 引入，票据 02 起类型与默认值收敛到 @crimson/engine）。
 * 配置文件路径由 CONFIG_PATH 环境变量指定（compose 中挂载 /app/config/game-config.json），
 * 缺失字段回退到引擎内置默认值；本地开发无配置文件时直接用默认值。
 */
import { readFileSync } from "node:fs";
import { DEFAULT_GAME_CONFIG, type GameConfig } from "@crimson/engine";

export type { GameConfig, RankReward } from "@crimson/engine";

export function loadGameConfig(path?: string): GameConfig {
  if (!path) return DEFAULT_GAME_CONFIG;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<GameConfig>;
    return { ...DEFAULT_GAME_CONFIG, ...raw };
  } catch (err) {
    console.warn(`[config] 配置文件 ${path} 读取失败，使用默认配置:`, (err as Error).message);
    return DEFAULT_GAME_CONFIG;
  }
}
