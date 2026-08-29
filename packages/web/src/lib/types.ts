/**
 * 票据 14 — UI 交互组件的共享视图类型。
 * 描述"stateUpdate 快照"里 web 端看到的数据形状，组件只依赖本文件与 engine 的公开类型，
 * 不直接依赖引擎内部未裁剪结构。
 */
import type { PendingPrompt } from "@crimson/engine";

/** 牌桌玩家（redact 后公开字段；Picker 渲染头像/名字/座位用） */
export interface TablePlayer {
  id: string;
  name: string;
  seat: number;
  characterId: string | null;
  chips: number;
  tickets: number;
}

/**
 * stateUpdate.pendingPrompt 下发的形状：
 * - 目标玩家：完整 PendingPrompt（含 candidates / from，引擎 redactState 不裁剪）；
 * - 非目标玩家：裁剪态 `{ kind, waitingFor, promptText }`（只提示等待谁，见 redact.ts）。
 */
export type ViewPendingPrompt =
  | PendingPrompt
  | { kind: PendingPrompt["kind"]; waitingFor: string; promptText?: string };

/** 完整态才有 candidates：判断挂起交互是否等待我（并收窄为完整 PendingPrompt） */
export function pendingPromptForMe(
  prompt: ViewPendingPrompt | null,
  myPlayerId: string,
): prompt is PendingPrompt {
  return prompt !== null && "playerId" in prompt && prompt.playerId === myPlayerId;
}

/** 统一取"等待谁"的玩家 id（完整态 playerId / 裁剪态 waitingFor） */
export function pendingPromptWaiter(prompt: ViewPendingPrompt): string {
  return "playerId" in prompt ? prompt.playerId : prompt.waitingFor;
}
