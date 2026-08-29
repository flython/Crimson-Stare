/**
 * 票据 02 — 状态裁剪（私密信息可见性）。
 * 服务端按 WebSocket 连接逐个调用后下发；引擎 state 本体永远全量保存在服务端。
 * 金科玉律 1/2：手牌/弃牌区/删牌区/抽牌堆对他人不可见。
 * M2.4：pendingPrompt 的 chooseCard 候选牌 id 是私密的，只对目标玩家展开，其余人只见提示。
 */
import type { Card } from "../cards.js";
import type { GameState, PendingPrompt, PlayerZones } from "./state.js";

export type ZoneDigest = { count: number } | { cards: Card[] };

/** 他人视角：区域摘要化；本人视角：原样 */
function digestZone(zone: Card[], isSelf: boolean): ZoneDigest {
  return isSelf ? { cards: zone } : { count: zone.length };
}

function digestZones(z: PlayerZones, isSelf: boolean) {
  return {
    draw: { count: z.draw.length },
    hand: digestZone(z.hand, isSelf),
    discard: digestZone(z.discard, isSelf),
    play: { cards: z.play }, // 出牌区公开
    deleted: digestZone(z.deleted, isSelf),
    chips: z.chips,
    items: z.items,
  };
}

/** 待决交互裁剪：目标玩家见完整候选，其余人只见"等待 X 选择" */
function redactPrompt(prompt: PendingPrompt, viewerId: string): object | null {
  if (prompt.playerId !== viewerId) {
    return {
      kind: prompt.kind,
      waitingFor: prompt.playerId,
      promptText: prompt.promptText,
    };
  }
  return prompt; // 目标玩家：完整（含 candidates）
}

export function redactState(state: GameState, viewerId: string): object {
  return {
    players: state.players.map((p) => {
      const isSelf = p.id === viewerId;
      return {
        id: p.id,
        name: p.name,
        seat: p.seat,
        characterId: p.characterId,
        chips: p.chips,
        tickets: p.tickets,
        swapLeft: p.swapLeft,
        purchaseFlipped: p.purchaseFlipped,
        phaseReady: p.phaseReady,
        zones: digestZones(p.zones, isSelf),
      };
    }),
    phase: state.phase,
    turn: state.turn,
    passHolderSeat: state.passHolderSeat,
    blackMarket: {
      slots: state.blackMarket.slots,
      supplyCount: state.blackMarket.supply.length,
    },
    eventCardId: state.eventCardId,
    pendingPrompt: state.pendingPrompt ? redactPrompt(state.pendingPrompt, viewerId) : null,
    log: state.log,
    finished: state.finished,
    winners: state.winners,
  };
}
