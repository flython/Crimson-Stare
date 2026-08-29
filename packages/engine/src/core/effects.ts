/**
 * 票据 02 — 时间点框架与效果注册表（硬编码路线，不做 DSL）。
 *
 * 模型：
 * - 每个效果 = 一条 EffectDef 注册进注册表，声明 (phase, timing) 触发点与来源类别；
 * - reducer 在进入/执行/离开阶段时调用 resolveTiming() 取"本时间点应结算的效果队列"；
 * - 同时机排序（金科玉律 6/14）：
 *   1) 来源优先级 事件牌 > 角色技能 > 黑市牌 > 规则书（priority 小者先）；
 *   2) 同来源不同玩家：从临时特权证持有者开始顺时针（clockwiseDistance 小者先）；
 *   3) 同玩家同来源：按注册顺序（引擎层无需"任选顺序"交互，M2 有需求再加 Action）。
 */
import type { GameState, PhaseId } from "./state.js";
import type { GameConfig } from "./config.js";

export type Timing = "before" | "during" | "after";

/** 效果来源类别，决定优先级：事件牌 > 角色技能 > 黑市牌 > 规则书 */
export type EffectSource = "event" | "character" | "blackMarket" | "rulebook";

/** 数字越小优先级越高 */
export const SOURCE_PRIORITY: Record<EffectSource, number> = {
  event: 0,
  character: 1,
  blackMarket: 2,
  rulebook: 3,
};

/** 效果执行上下文（engine 不做 IO；server 注入 config，log 直接写 state） */
export interface EffectContext {
  config: GameConfig;
  /** 触发该效果的玩家（规则书类效果为 null） */
  playerId: string | null;
}

export interface EffectDef {
  /** 全局唯一，如 "char-miner-black-bonus" / "bm-valsart-chip" */
  id: string;
  source: EffectSource;
  phase: PhaseId;
  timing: Timing;
  /** 效果体：直接变更 state（reducer 已保证传入的是工作副本） */
  run: (state: GameState, ctx: EffectContext) => void;
}

const registry = new Map<string, EffectDef>();

export function registerEffect(def: EffectDef): void {
  if (registry.has(def.id)) throw new Error(`效果 id 重复注册: ${def.id}`);
  registry.set(def.id, def);
}

export function getEffect(id: string): EffectDef | undefined {
  return registry.get(id);
}

/** 顺时针距离：从特权证持有者数到目标座位的步数 */
function clockwiseDistance(state: GameState, seat: number): number {
  const holder = state.passHolderSeat;
  if (holder === null) return seat; // 无持证者（理论不发生）退化为座位号
  return (seat - holder + state.players.length) % state.players.length;
}

export interface QueuedEffect {
  def: EffectDef;
  playerId: string | null;
}

/**
 * 取某时间点的效果结算队列（已排序）。
 * onlyPlayer 过滤：服务端逐玩家结算前可按需过滤（骨架暂不用，接口先留）。
 */
export function resolveTiming(
  state: GameState,
  phase: PhaseId,
  timing: Timing,
  config: GameConfig,
  onlyPlayer?: string,
): QueuedEffect[] {
  const queue: QueuedEffect[] = [];
  for (const def of registry.values()) {
    if (def.phase !== phase || def.timing !== timing) continue;
    if (onlyPlayer && def.source !== "rulebook") {
      // 玩家效果：该效果挂在哪个玩家身上由 M2 效果层判定可用性，骨架先全量入队
    }
    const playerId = def.source === "rulebook" ? null : onlyPlayer ?? state.players[0]?.id ?? null;
    queue.push({ def, playerId });
  }
  queue.sort((a, b) => {
    const p = SOURCE_PRIORITY[a.def.source] - SOURCE_PRIORITY[b.def.source];
    if (p !== 0) return p;
    const seatA = a.playerId ? (state.players.find((x) => x.id === a.playerId)?.seat ?? 0) : 0;
    const seatB = b.playerId ? (state.players.find((x) => x.id === b.playerId)?.seat ?? 0) : 0;
    return clockwiseDistance(state, seatA) - clockwiseDistance(state, seatB);
  });
  void config;
  return queue;
}

/** 依序执行队列（异常隔离到单条效果，避免一张坏卡毁掉整局） */
export function runTimingQueue(state: GameState, queue: QueuedEffect[], config: GameConfig): void {
  for (const { def, playerId } of queue) {
    try {
      def.run(state, { config, playerId });
    } catch (err) {
      state.log.push({
        turn: state.turn,
        phase: state.phase,
        text: `效果 ${def.id} 执行失败: ${(err as Error).message}`,
      });
    }
  }
}
