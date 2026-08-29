/**
 * 票据 02 — 可重放 RNG。
 * mulberry32：32 位状态全部存在 GameState.rngState 里，
 * 重放 = 初始 rngState(种子) + 有序 Action 流，引擎不引入任何外部随机源。
 */

/** 从 state 内嵌状态取下一个 [0,1) 随机数（就地推进 rngState） */
export function nextRandom(state: { rngState: number }): number {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** [0, n) 整数 */
export function nextInt(state: { rngState: number }, n: number): number {
  return Math.floor(nextRandom(state) * n);
}

/** 就地 Fisher-Yates 洗牌 */
export function shuffle<T>(state: { rngState: number }, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(state, i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** 生成一个随机初始种子（仅开局时调用一次，之后种子随 state 走） */
export function newSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
