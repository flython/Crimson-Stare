/**
 * 交互机制原语（M2.4，grilling Q4 最小交互原语）。
 *
 * 模型：
 * - 效果 run 写入 state.pendingPrompt 并 return（挂起），reducer 只接受目标玩家的 resolvePrompt；
 * - EffectDef.resolve 接收玩家选择继续执行（两段式：run 发 prompt，resolve 收选择）；
 * - 简单交互（choosePlayer 单目标 / chooseCard 多选）不携带中间状态；
 *   复杂多步交互（暗拍/拍卖/轮流掷骰）留 M3（票据 13 Notes 已注明）。
 * - autoResolve 供 server 超时托管（timeoutPolicy="auto"）：choosePlayer 随机选，chooseCard 默认不选。
 */
import type { GameState, PendingPrompt, ZoneId } from "../core/state.js";
import { nextInt } from "../core/rng.js";

/** 效果触发时挂起：请目标玩家选一名候选玩家 */
export function promptChoosePlayer(
  state: GameState,
  effectId: string,
  playerId: string,
  candidates: string[],
  promptText?: string,
): void {
  if (state.pendingPrompt) throw new Error(`已有待决交互 ${state.pendingPrompt.effectId}，不能并发挂起`);
  if (candidates.length === 0) throw new Error(`效果 ${effectId} 无可选玩家`);
  state.pendingPrompt = {
    kind: "choosePlayer",
    effectId,
    playerId,
    candidates,
    promptText,
  } satisfies PendingPrompt;
}

/** 效果触发时挂起：请目标玩家从指定区域选牌（支持多选） */
export function promptChooseCard(
  state: GameState,
  effectId: string,
  playerId: string,
  candidates: string[],
  from: ZoneId,
  promptText?: string,
): void {
  if (state.pendingPrompt) throw new Error(`已有待决交互 ${state.pendingPrompt.effectId}，不能并发挂起`);
  if (candidates.length === 0) throw new Error(`效果 ${effectId} 无可选牌`);
  state.pendingPrompt = {
    kind: "chooseCard",
    effectId,
    playerId,
    candidates,
    from,
    promptText,
  } satisfies PendingPrompt;
}

/** 校验玩家对 resolvePrompt 的选择是否合法（reducer 调用，非法即拒绝） */
export function validateChoice(prompt: PendingPrompt, choice: string | string[]): void {
  if (prompt.kind === "choosePlayer") {
    if (typeof choice !== "string" || !prompt.candidates.includes(choice)) {
      throw new Error(`非法选择：choosePlayer 需要候选玩家之一`);
    }
    return;
  }
  // chooseCard：string[]，每项在候选内且不重复
  if (!Array.isArray(choice)) throw new Error(`非法选择：chooseCard 需要牌 id 数组`);
  const set = new Set(choice);
  if (set.size !== choice.length) throw new Error(`非法选择：牌 id 重复`);
  for (const id of choice) {
    if (!prompt.candidates.includes(id)) throw new Error(`非法选择：牌 ${id} 不在候选内`);
  }
}

/** 超时托管（timeoutPolicy="auto"）：返回默认选择供 server 自动 resolve */
export function autoResolve(state: GameState): string | string[] {
  const prompt = state.pendingPrompt;
  if (!prompt) return [];
  if (prompt.kind === "choosePlayer") {
    return prompt.candidates[nextInt(state, prompt.candidates.length)]!;
  }
  return []; // chooseCard 超时默认不选
}

/** 取待决交互的目标玩家名（日志/横幅用） */
export function promptTargetName(state: GameState, prompt: PendingPrompt): string {
  return state.players.find((p) => p.id === prompt.playerId)?.name ?? prompt.playerId;
}
