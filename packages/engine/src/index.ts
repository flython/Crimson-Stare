/**
 * 血色牌局 Web 版 — 游戏引擎包
 *
 * 纯 TS 状态机，无 IO 依赖，前后端共用。
 */

export const ENGINE_VERSION = "0.1.0";

export * from "./cards.js";
export * from "./cardPool.js";
export * from "./hand-evaluator.js";
export * from "./core/state.js";
export * from "./core/config.js";
export * from "./core/rng.js";
export * from "./core/effects.js";
export * from "./core/redact.js";
export * from "./effects/index.js";
export * from "./game/whiteboard.js";
