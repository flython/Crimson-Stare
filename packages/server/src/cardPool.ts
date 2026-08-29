/**
 * 卡池载入(票据 06 遗留项落地,grilling Q3:JSON 提交 git + server 启动时读入注入 engine)。
 *
 * 与 loadGameConfig 同模式:server 是唯一读盘方,engine 保持纯函数不读盘;
 * 卡池文件缺失/损坏 → 直接抛错退出(server crash,不静默),因为缺少卡池游戏无法开始。
 * 配置文件目录由 CONFIG_DIR 环境变量指定(compose 挂载 /app/config,内含 game-config.json + cards/*.json)。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CardPool } from "@crimson/engine";

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf-8")) as T;
}

export function loadCardPool(configDir?: string): CardPool {
  const base = configDir ?? process.env.CONFIG_DIR ?? join(process.cwd(), "config");
  const cardsDir = join(base, "cards");
  const manifest = readJson<{ version: string; counts: CardPool["counts"] }>(join(cardsDir, "manifest.json"));
  return {
    version: manifest.version,
    counts: manifest.counts,
    roles: readJson(join(cardsDir, "roles.json")),
    market: readJson(join(cardsDir, "market.json")),
    fate: readJson(join(cardsDir, "fate.json")),
    events: readJson(join(cardsDir, "events.json")),
  };
}
