/**
 * 血色牌局 Web 版 — 服务端入口。
 *
 * 票据 15 — 房间模型与 WS 协议落地（room.ts）：建房/入房/开始/action/resolvePrompt/
 * 超时托管/redact 裁剪广播。本文件只做装配：载配置/卡池 → 启动 WS → 连接绑定 RoomManager。
 */
import { WebSocketServer } from "ws";
import { ENGINE_VERSION } from "@crimson/engine";
import { loadGameConfig } from "./config.js";
import { loadCardPool } from "./cardPool.js";
import { RoomManager } from "./room.js";

const PORT = Number(process.env.PORT ?? 8080);

export function startServer(opts: { port?: number } = {}): { wss: WebSocketServer; manager: RoomManager } {
  const config = loadGameConfig(process.env.CONFIG_PATH);
  const pool = loadCardPool(process.env.CONFIG_DIR);
  const manager = new RoomManager(config, pool);
  const wss = new WebSocketServer({ port: opts.port ?? PORT });
  wss.on("connection", (socket) => manager.attach(socket));

  console.log(
    `[server] ws 服务已启动 :${wss.address() && typeof wss.address() === "object" ? (wss.address() as { port: number }).port : PORT} (engine v${ENGINE_VERSION}) 2人局目标 ${config.ticketGoals["2"]} 票`,
  );
  console.log(
    `[server] 卡池已载入 v${pool.version}: 角色 ${pool.counts.role} / 黑市 ${pool.counts.market} / 命运 ${pool.counts.fate} / 事件 ${pool.counts.event}`,
  );
  return { wss, manager };
}

// 直接作为入口运行时启动（被测试 import 时不启动，测试自行构造）
if (process.argv[1] && import.meta.url === new URL(process.argv[1], import.meta.url).href) {
  startServer();
}
