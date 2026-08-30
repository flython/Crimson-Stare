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
  /** 当前执行的效果 id（日志定位 / 交互提示） */
  effectId: string;
  /**
   * 交互中间态回传（票据 20）：来自 pendingPrompt.carry，仅 chooseCard 挂起的 resolve 阶段有值。
   * 跨玩家链式交互（026 逐位对手删牌、033 宣称点数）用它传递队列/宣称值。
   */
  carry?: string;
}

export interface EffectDef {
  /** 全局唯一，如 "role:01:reshape" / "market:001:during:duel" */
  id: string;
  source: EffectSource;
  phase: PhaseId;
  timing: Timing;
  /** 角色技能专属：该效果属于哪张角色牌（source=character 时生效，resolveTiming 按持有者展开） */
  roleId?: string;
  /** 效果体：直接变更 state（reducer 已保证传入的是工作副本） */
  run: (state: GameState, ctx: EffectContext) => void;
  /**
   * 交互效果（M2.4）：run 写入 state.pendingPrompt 挂起，玩家 resolvePrompt 后调用本函数继续。
   * choice 形状由 prompt.kind 决定：choosePlayer → string（玩家 id）；chooseCard → string[]（牌 id 列表）。
   */
  resolve?: (state: GameState, ctx: EffectContext, choice: string | string[]) => void;
}

const registry = new Map<string, EffectDef>();

export function registerEffect(def: EffectDef): void {
  if (registry.has(def.id)) throw new Error(`效果 id 重复注册: ${def.id}`);
  registry.set(def.id, def);
}

export function getEffect(id: string): EffectDef | undefined {
  return registry.get(id);
}

/**
 * 动作钩子（角色技能内嵌在 reducer 动作中触发的效果，如酒保"剩余换牌次数为0"）。
 * reshuffle / noReshuffle 为票据 20 新增：洗衣房店主"重洗牌库时得 1 血筹 / 不重洗额外得 2 血筹"。
 */
export type ActionHookName = "swapZero" | "reshuffle" | "noReshuffle";

const actionHooks = new Map<string, { hook: ActionHookName; run: (state: GameState, ctx: EffectContext) => void }>();

export function registerActionHook(
  characterId: string,
  hook: ActionHookName,
  run: (state: GameState, ctx: EffectContext) => void,
): void {
  const key = `${characterId}:${hook}`;
  if (actionHooks.has(key)) throw new Error(`动作钩子重复注册: ${key}`);
  actionHooks.set(key, { hook, run });
}

/** reducer 在动作发生点调用（异常隔离到单条，坏卡不毁局；交互挂起时停止后续） */
export function runActionHook(
  state: GameState,
  characterId: string | null,
  hook: ActionHookName,
  config: GameConfig,
  playerId: string,
): void {
  if (!characterId) return;
  const entry = actionHooks.get(`${characterId}:${hook}`);
  if (!entry) return;
  // 技能失效（暂时失忆/磁山隧道类）时角色钩子不发动（金科玉律：技能失效即不发动）
  if (state.players.find((x) => x.id === playerId)?.skillDisabled) return;
  try {
    entry.run(state, { config, playerId, effectId: `hook:${characterId}:${hook}` });
  } catch (err) {
    state.log.push({
      turn: state.turn,
      phase: state.phase,
      text: `动作钩子 ${characterId}:${hook} 执行失败: ${(err as Error).message}`,
    });
  }
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

/** 依序执行队列（异常隔离到单条效果，避免一张坏卡毁掉整局；交互挂起时暂停队列） */
export function runTimingQueue(state: GameState, queue: QueuedEffect[], config: GameConfig): void {
  for (const { def, playerId } of queue) {
    try {
      def.run(state, { config, playerId, effectId: def.id });
    } catch (err) {
      state.log.push({
        turn: state.turn,
        phase: state.phase,
        text: `效果 ${def.id} 执行失败: ${(err as Error).message}`,
      });
    }
    if (state.pendingPrompt) break; // 交互挂起：等 resolvePrompt 后再继续（余下效果 M2 不自动恢复，交互效果各自独立）
  }
}
