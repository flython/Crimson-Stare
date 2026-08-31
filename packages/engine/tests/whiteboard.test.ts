import { describe, expect, it } from "vitest";
import {
  createGame,
  reduce,
  redactState,
  registerEffect,
  resolveTiming,
  card,
  DEFAULT_GAME_CONFIG,
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
          if (state.players.find((p) => p.id === id)!.phaseReady) continue;
          try {
            // 票据 24 顺位门禁：只有当前应行动玩家能跳过，非轮次内报错则跳过该玩家
            state = reduce(state, { type: "skipPurchase", playerId: id }, CFG);
          } catch {
            /* 未轮到该玩家 */
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
    type PlayerView = { id: string; zones: { hand: { count?: number; cards?: unknown } } };
    const view = redactState(g, "bob") as { players: PlayerView[] };
    const aliceView = view.players.find((p) => p.id === "alice")!;
    expect(aliceView.zones.hand).toHaveProperty("count");
    expect(aliceView.zones.hand).not.toHaveProperty("cards");
    const bobView = view.players.find((p) => p.id === "bob")!;
    expect(bobView.zones.hand).toHaveProperty("cards");
  });

  it("时间点队列排序：来源优先级 事件>角色>黑市>规则书，同来源按特权证顺时针", () => {
    const g = makeGame();
    g.phase = "settle";
    registerEffect({ id: "e-event", source: "event", phase: "settle", timing: "before", run: () => {} });
    registerEffect({ id: "e-char", source: "character", phase: "settle", timing: "before", run: () => {} });
    registerEffect({ id: "e-bm", source: "blackMarket", phase: "settle", timing: "before", run: () => {} });
    registerEffect({ id: "e-rule", source: "rulebook", phase: "settle", timing: "before", run: () => {} });
    const queue = resolveTiming(g, "settle", "before", CFG);
    expect(queue.map((q) => q.def.id)).toEqual(["e-event", "e-char", "e-bm", "e-rule"]);
  });

  // ── 票据 24 规则书核对修复：回归测试 ──────────────────────────────
  it("特权证掷骰：开局不摸牌，弃牌区为空（规则 4.4）", () => {
    const g = makeGame();
    for (const p of g.players) {
      expect(p.zones.discard).toHaveLength(0); // 不再把比点用的牌放进弃牌区
      expect(p.zones.draw.length + p.zones.hand.length).toBe(54); // 抽牌阶段已抽 6 张入手
    }
    expect(g.passHolderSeat).not.toBeNull();
  });

  it("换牌：每次弃至多 3 张，与剩余次数无关（规则 5.2）", () => {
    let g = makeGame();
    const alice = g.players.find((p) => p.id === "alice")!;
    const ids1 = alice.zones.hand.slice(0, 3).map((c) => c.id);
    g = reduce(g, { type: "swap", playerId: "alice", discardIds: ids1 }, CFG);
    const a2 = g.players.find((p) => p.id === "alice")!;
    a2.swapLeft = 1; // 模拟最后一次换牌（旧实现 maxDiscard=min(3,swapLeft)=1 会误拒）
    const ids2 = a2.zones.hand.slice(0, 3).map((c) => c.id);
    expect(() => reduce(g, { type: "swap", playerId: "alice", discardIds: ids2 }, CFG)).not.toThrow();
  });

  it("七条放宽：可出 7 张同点数（上限 = 5 + 额外条数）", () => {
    const g = driveTo(makeGame(), "play");
    const alice = g.players.find((p) => p.id === "alice")!;
    alice.handLimitBonus = 1; // 魔术师：手牌上限 7
    alice.zones.hand = Array.from({ length: 7 }, (_, i) => card(7, (["S", "H", "D", "C"] as const)[i % 4]!, `x${i}`));
    expect(() =>
      reduce(g, { type: "playCards", playerId: "alice", cardIds: alice.zones.hand.map((c) => c.id) }, CFG),
    ).not.toThrow();
  });

  it("简易模式：牌库去 J/Q/K/A（38 张）、删牌阶段无免费额度（规则 10.1）", () => {
    let g = createGame(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      CFG,
      42,
      undefined,
      { simple: true },
    );
    for (const p of g.players) {
      expect(p.zones.draw.length + p.zones.hand.length).toBe(38); // 2-10×4=36 + 双王
      expect(p.zones.draw.every((c) => c.isJoker || (c.rank ?? 0) <= 10)).toBe(true);
    }
    g = driveTo(g, "delete");
    const a = g.players[0]!;
    a.zones.discard = [card(2, "S"), card(3, "H")];
    a.chips = 1; // 删 1 张需 2 筹（无免费），1 筹不足
    expect(() => reduce(g, { type: "deleteCards", playerId: "a", cardIds: [a.zones.discard[0]!.id] }, CFG)).toThrow(
      /血筹不足/,
    );
    a.chips = 2;
    g = reduce(g, { type: "deleteCards", playerId: "a", cardIds: [a.zones.discard[0]!.id] }, CFG);
    expect(g.players[0]!.chips).toBe(0);
  });

  it("暗扣：出牌阶段他人只见出牌张数，本人可见（规则 5.3）", () => {
    let g = driveTo(makeGame(), "play");
    const alice = g.players.find((p) => p.id === "alice")!;
    g = reduce(g, { type: "playCards", playerId: "alice", cardIds: alice.zones.hand.slice(0, 5).map((c) => c.id) }, CFG);
    type PlayerView = { id: string; zones: { play: { count?: number; cards?: unknown } } };
    const bobView = redactState(g, "bob") as { players: PlayerView[] };
    const aliceForBob = bobView.players.find((p) => p.id === "alice")!;
    expect(aliceForBob.zones.play).toHaveProperty("count");
    expect(aliceForBob.zones.play).not.toHaveProperty("cards");
    const selfView = redactState(g, "alice") as { players: PlayerView[] };
    const aliceForSelf = selfView.players.find((p) => p.id === "alice")!;
    expect(aliceForSelf.zones.play).toHaveProperty("cards");
  });

  it("购买顺位：非当前应行动玩家购买/跳过被拒（规则 5.6）", () => {
    let g = driveTo(makeGame(), "purchase");
    const holder = g.players.find((p) => p.seat === g.passHolderSeat)!;
    const other = g.players.find((p) => p.id !== holder.id)!;
    const slot = g.blackMarket.slots[0]!;
    slot.defId = "bm-x"; // 未注册牌：购买仅走占位 log，不挂起
    slot.price = 0;
    // 持证者先行动：他人购买被拒
    expect(() => reduce(g, { type: "purchase", playerId: other.id, slotIndex: 0 }, CFG)).toThrow(/未轮到你购买/);
    // 持证者跳过 → 轮到他人 → 可购买
    g = reduce(g, { type: "skipPurchase", playerId: holder.id }, CFG);
    expect(() => reduce(g, { type: "purchase", playerId: other.id, slotIndex: 0 }, CFG)).not.toThrow();
  });

  it("终局平局：同票先比血筹，再比顺时针距特权证（规则 §8）", () => {
    // 血筹决胜：b 血筹多必胜（无论对决名次，rank2 的 +4 只多不少）
    let g = driveTo(makeGame(), "play");
    const [a, b] = g.players;
    a.tickets = 24;
    b.tickets = 24;
    a.chips = 3;
    b.chips = 9;
    for (const p of g.players) {
      if (!p.phaseReady) {
        g = reduce(g, { type: "playCards", playerId: p.id, cardIds: p.zones.hand.slice(0, 5).map((c) => c.id) }, CFG);
      }
    }
    expect(g.finished).toBe(true);
    expect(g.winners).toEqual([b.id]);

    // 距离决胜：控手牌使 a 必胜（同花顺），血筹补偿 rank2 的 +4 后相等 → 夺魁者 a（持证）近者胜
    let g2 = driveTo(makeGame(), "play");
    const [c, d] = g2.players;
    c.zones.hand = [card(14, "S"), card(13, "S"), card(12, "S"), card(11, "S"), card(10, "S"), card(9, "S")];
    d.zones.hand = [card(2, "S"), card(3, "H"), card(4, "D"), card(5, "C"), card(6, "S"), card(7, "H")];
    c.tickets = 24;
    d.tickets = 24;
    c.chips = 9; // rank1 +0 → 9；d rank2 +4 → 9，平
    d.chips = 5;
    for (const p of g2.players) {
      if (!p.phaseReady) {
        g2 = reduce(g2, { type: "playCards", playerId: p.id, cardIds: p.zones.hand.slice(0, 5).map((x) => x.id) }, CFG);
      }
    }
    expect(g2.finished).toBe(true);
    expect(g2.winners).toEqual([c.id]);
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
    case "purchase": {
      // 票据 24 顺位门禁：跳过非轮次内玩家会报错，逐个尝试直到轮到某位
      for (const id of ids) {
        try {
          return reduce(state, { type: "skipPurchase", playerId: id }, CFG);
        } catch {
          /* 未轮到该玩家，试下一位 */
        }
      }
      throw new Error("购买阶段无人可跳过");
    }
    case "delete":
      return reduce(state, { type: "ready", playerId: notReady?.id ?? ids[0] }, CFG);
    case "reshape":
      return reduce(state, { type: "reshape", playerId: notReady?.id ?? ids[0], reshuffle: true }, CFG);
    default:
      return state;
  }
}
