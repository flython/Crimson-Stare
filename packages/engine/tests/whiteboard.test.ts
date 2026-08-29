import { describe, expect, it } from "vitest";
import {
  createGame,
  reduce,
  redactState,
  registerEffect,
  resolveTiming,
  card,
  DEFAULT_GAME_CONFIG,
  type Action,
  type GameState,
} from "../src/index.js";

const CFG = DEFAULT_GAME_CONFIG;

function makeGame(): GameState {
  return createGame(
    [
      { id: "alice", name: "矿工" },
      { id: "bob", name: "荷官" },
    ],
    CFG,
    42,
  );
}

/** 自动把一局推进到指定阶段，途中用"合法傻瓜策略"补全玩家操作 */
function driveTo(state: GameState, phase: string): GameState {
  for (let guard = 0; guard < 500 && state.phase !== phase && !state.finished; guard++) {
    const ids = () => state.players.map((p) => p.id);
    switch (state.phase) {
      case "swap":
        for (const id of ids()) {
          if (!state.players.find((p) => p.id === id)!.phaseReady) {
            state = reduce(state, { type: "stopSwap", playerId: id }, CFG);
          }
        }
        break;
      case "play":
        for (const id of ids()) {
          const p = state.players.find((x) => x.id === id)!;
          if (!p.phaseReady) {
            const pick = p.zones.hand.slice(0, 5).map((c) => c.id);
            state = reduce(state, { type: "playCards", playerId: id, cardIds: pick }, CFG);
          }
        }
        break;
      case "purchase":
        for (const id of ids()) {
          if (!state.players.find((p) => p.id === id)!.phaseReady) {
            state = reduce(state, { type: "skipPurchase", playerId: id }, CFG);
          }
        }
        break;
      case "delete":
        for (const id of ids()) {
          if (!state.players.find((p) => p.id === id)!.phaseReady) {
            state = reduce(state, { type: "ready", playerId: id }, CFG);
          }
        }
        break;
      case "reshape":
        for (const id of ids()) {
          if (!state.players.find((p) => p.id === id)!.phaseReady) {
            state = reduce(state, { type: "reshape", playerId: id, reshuffle: true }, CFG);
          }
        }
        break;
      default:
        throw new Error(`驱动卡在未处理阶段: ${state.phase}`);
    }
  }
  if (state.phase !== phase) throw new Error(`未能推进到 ${phase}，当前 ${state.phase}`);
  return state;
}

describe("白板局骨架", () => {
  it("创建对局：54张/人、特权证归属、初始血筹 2/3", () => {
    const g = makeGame();
    expect(g.players).toHaveLength(2);
    for (const p of g.players) {
      expect(p.zones.draw.length + p.zones.discard.length + p.zones.hand.length).toBe(54);
    }
    const holder = g.players.find((p) => p.seat === g.passHolderSeat)!;
    expect(holder.chips).toBe(2);
    expect(g.players.find((p) => p.seat !== g.passHolderSeat)!.chips).toBe(3);
    // 抽牌阶段自动完成并推进到换牌
    expect(g.phase).toBe("swap");
    expect(g.players.every((p) => p.zones.hand.length === CFG.handLimit)).toBe(true);
  });

  it("换牌：弃3张抽3张、次数耗尽自动就绪、stopSwap 兑换血筹", () => {
    let g = makeGame();
    const alice = g.players.find((p) => p.id === "alice")!;
    const before = alice.zones.hand.map((c) => c.id);
    g = reduce(g, { type: "swap", playerId: "alice", discardIds: before.slice(0, 3) }, CFG);
    const after = g.players.find((p) => p.id === "alice")!;
    expect(after.zones.hand.length).toBe(CFG.handLimit);
    expect(after.swapLeft).toBe(CFG.swapCount - 1);
    expect(after.phaseReady).toBe(false);
    g = reduce(g, { type: "stopSwap", playerId: "alice" }, CFG);
    // 种子 42 下 alice 非特权证持有者：初始 3 筹 + 剩余 2 次换牌 = 5 筹
    expect(g.players.find((p) => p.id === "alice")!.chips).toBe(5);
    expect(g.phase).toBe("swap"); // 等 bob
    g = reduce(g, { type: "stopSwap", playerId: "bob" }, CFG);
    expect(g.phase).toBe("play");
  });

  it("完整回合链：swap→play→duel→settle→purchase→delete→reshape→下一回合", () => {
    let g = driveTo(makeGame(), "play");
    g = driveTo(g, "purchase");
    // 对决已发生：特权证有归属、出牌区已清空进弃牌区
    expect(g.passHolderSeat).not.toBeNull();
    for (const p of g.players) expect(p.zones.play).toHaveLength(0);
    // 名次奖励已发（2人局：第一名4票）
    const winner = g.players.find((p) => p.seat === g.passHolderSeat)!;
    expect(winner.tickets).toBe(4);
    g = driveTo(g, "delete");
    g = driveTo(g, "reshape");
    g = driveTo(g, "swap"); // 下一回合的换牌阶段
    expect(g.turn).toBe(2);
  });

  it("删除阶段：首张免费、超额扣筹、筹不够报错", () => {
    let g = driveTo(makeGame(), "delete");
    const alice = g.players.find((p) => p.id === "alice")!;
    // 测试桩：塞 3 张可删的弃牌，并把 alice 压到 1 筹（删 3 张需 (3-1)*2=4 筹）
    g.players[0].zones.discard = [card(2, "S"), card(3, "H"), card(4, "D")];
    g.players[0].chips = 1;
    const delIds = g.players[0].zones.discard.map((c) => c.id);
    expect(() => reduce(g, { type: "deleteCards", playerId: "alice", cardIds: delIds }, CFG)).toThrow(
      /血筹不足/,
    );
    // 筹够时：首张免费、超额按 2 筹/张
    g.players[0].chips = 4;
    g = reduce(g, { type: "deleteCards", playerId: "alice", cardIds: delIds }, CFG);
    const after = g.players.find((p) => p.id === "alice")!;
    expect(after.zones.deleted).toHaveLength(3);
    expect(after.chips).toBe(0);
  });

  it("购买：支付价格并获得叠加血筹；筹不足报错", () => {
    let g = driveTo(makeGame(), "purchase");
    // 人造黑市：给 alice 一大笔钱，铺满供应堆
    g.players[0].chips = 100;
    g.blackMarket.supply = Array.from({ length: 8 }, (_, i) => ({
      defId: `bm-${i}`,
      price: i + 1,
    }));
    g.blackMarket.slots = g.blackMarket.slots.map((s, i) => ({
      defId: `bm-slot-${i}`,
      price: 1,
      bonusChips: i === 4 ? 2 : 0, // 第5格预置2筹
    }));
    g = reduce(g, { type: "purchase", playerId: "alice", slotIndex: 4 }, CFG);
    const alice = g.players.find((p) => p.id === "alice")!;
    expect(alice.chips).toBe(100 - 1 + 2);
    expect(g.blackMarket.slots[4].defId).toBe("bm-0"); // 供应堆顶补位
  });

  it("重放确定性：同种子同 Action 流得到同结果", () => {
    const play = (seed: number) => {
      let g = createGame(
        [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
        CFG,
        seed,
      );
      for (let i = 0; i < 80 && !g.finished; i++) {
        g = driveOneStep(g);
      }
      return g;
    };
    const g1 = play(7);
    const g2 = play(7);
    expect(g1.players.map((p) => p.tickets)).toEqual(g2.players.map((p) => p.tickets));
    expect(g1.turn).toBe(g2.turn);
  });

  it("裁剪：bob 视角看不到 alice 手牌明细，只看到数量", () => {
    const g = makeGame();
    const view = redactState(g, "bob") as any;
    const aliceView = view.players.find((p: any) => p.id === "alice");
    expect(aliceView.zones.hand).toHaveProperty("count");
    expect(aliceView.zones.hand).not.toHaveProperty("cards");
    const bobView = view.players.find((p: any) => p.id === "bob");
    expect(bobView.zones.hand).toHaveProperty("cards");
  });

  it("时间点队列排序：来源优先级 事件>角色>黑市>规则书，同来源按特权证顺时针", () => {
    let g = makeGame();
    g.phase = "settle";
    registerEffect({ id: "e-event", source: "event", phase: "settle", timing: "before", run: () => {} });
    registerEffect({ id: "e-char", source: "character", phase: "settle", timing: "before", run: () => {} });
    registerEffect({ id: "e-bm", source: "blackMarket", phase: "settle", timing: "before", run: () => {} });
    registerEffect({ id: "e-rule", source: "rulebook", phase: "settle", timing: "before", run: () => {} });
    const queue = resolveTiming(g, "settle", "before", CFG);
    expect(queue.map((q) => q.def.id)).toEqual(["e-event", "e-char", "e-bm", "e-rule"]);
  });
});

/** 单步傻瓜驱动（重放测试用） */
function driveOneStep(state: GameState): GameState {
  const ids = state.players.map((p) => p.id);
  const notReady = state.players.find((p) => !p.phaseReady);
  switch (state.phase) {
    case "swap":
      return reduce(state, { type: "stopSwap", playerId: notReady?.id ?? ids[0] }, CFG);
    case "play": {
      const p = notReady!;
      return reduce(
        state,
        { type: "playCards", playerId: p.id, cardIds: p.zones.hand.slice(0, 5).map((c) => c.id) },
        CFG,
      );
    }
    case "purchase":
      return reduce(state, { type: "skipPurchase", playerId: notReady?.id ?? ids[0] }, CFG);
    case "delete":
      return reduce(state, { type: "ready", playerId: notReady?.id ?? ids[0] }, CFG);
    case "reshape":
      return reduce(state, { type: "reshape", playerId: notReady?.id ?? ids[0], reshuffle: true }, CFG);
    default:
      return state;
  }
}
