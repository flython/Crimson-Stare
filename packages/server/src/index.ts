/**
 * 血色牌局 Web 版 — 服务端占位入口
 *
 * 仅验证 ws 依赖与 engine 包引用链路可跑通。
 * 房间模型 / 协议 / 同步逻辑由票据 04 设计后落地。
 */
import { WebSocketServer } from "ws";
import { ENGINE_VERSION } from "@crimson/engine";
import { loadGameConfig } from "./config.js";
import { loadCardPool } from "./cardPool.js";

const PORT = Number(process.env.PORT ?? 8080);
const config = loadGameConfig(process.env.CONFIG_PATH);
const pool = loadCardPool(process.env.CONFIG_DIR);

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "hello", engineVersion: ENGINE_VERSION }));
});

console.log(
  `[server] ws 服务已启动 :${PORT} (engine v${ENGINE_VERSION}) 2人局目标 ${config.ticketGoals["2"]} 票`,
);
console.log(
  `[server] 卡池已载入 v${pool.version}: 角色 ${pool.counts.role} / 黑市 ${pool.counts.market} / 命运 ${pool.counts.fate} / 事件 ${pool.counts.event}`,
);
