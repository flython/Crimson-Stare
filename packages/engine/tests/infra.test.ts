/**
 * 效果接入点验证（M2 共享基础设施，票据 11/12 前置）。
 *
 * 验证 whiteboard 对角色/黑市效果提供接入点正确：
 * 黑市构建（pool 注入/simple 过滤）、手牌上限加成、换牌次数加成、reshape hooks、swapZero 动作钩子。
 * 对决点数加成由 11 号票据的赌场荷官测试覆盖（需真实角色注入）。
 */
import { describe, it, expect } from "vitest";
import { createGame, reduce } from "../src/game/whiteboard.js";
import { DEFAULT_GAME_CONFIG } from "../src/core/config.js";
import { registerEffect, registerActionHook } from "../src/core/effects.js";
import { gainChips } from "../src/effects/primitives.js";
import type { CardPool } from "../src/cardPool.js";
import type { GameState } from "../src/core/state.js";

const CFG = DEFAULT_GAME_CONFIG;

const testPool: CardPool = {
  version: "test",
  counts: { role: 1, market: 3, fate: 0, event: 0 },
  roles: [
    { id: "01", name: "赌场荷官", category: "role", count: 1, simpleOnly: true, triggers: [], effectText: "x", image: "x" },
  ],
  market: [
    { id: "001", name: "校准器+1", category: "market", subtype: "强化芯片", count: 2, price: 4, yellowBorder: true, triggers: [], effectText: "x", image: "x" },
    { id: "027", name: "廉价删除", category: "market", subtype: "秘密交易", count: 1, price: 3, yellowBorder: true, triggers: [], effectText: "x", image: "x" },
    { id: "045", name: "信号干扰器", category: "market", subtype: "道具", count: 2, price: 3, yellowBorder: true, triggers: [], effectText: "x", image: "x" },
  ],
  fate: [],
  events: [],
};

function makeGame(): GameState {
  return createGame(
    [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    CFG,
    42,
  );
}

/** 傻瓜策略自动推进到指定阶段（参考 whiteboard.test.ts 的 driveTo） */
function driveTo(state: GameState, phase: string): GameState {
  for (let guard = 0; guard < 500 && state.phase !== phase && !state.finished; guard++) {
    for (const pid of state.players.map((p) => p.id)) {
      if (state.pendingPrompt) break;
      try {
        if (state.phase === "swap") state = reduce(state, { type: "stopSwap", playerId: pid }, CFG);
        else if (state.phase === "play") {
          const p = state.players.find((x) => x.id === pid)!;
          const cards = p.zones.hand.slice(0, Math.min(5, p.zones.hand.length)).map((c) => c.id);
          if (cards.length > 0) state = reduce(state, { type: "playCards", playerId: pid, cardIds: cards }, CFG);
        } else if (state.phase === "purchase") state = reduce(state, { type: "skipPurchase", playerId: pid }, CFG);
        else if (state.phase === "delete") state = reduce(state, { type: "ready", playerId: pid }, CFG);
        else if (state.phase === "reshape") state = reduce(state, { type: "reshape", playerId: pid, reshuffle: false }, CFG);
      } catch {
        /* 该玩家此阶段已就绪，跳过 */
      }
    }
  }
  return state;
}

describe("效果接入点（M2 基础设施）", () => {
  it("createGame 注入 pool：黑市供应堆按 count 展开并填满栏位，simple 过滤黄边", () => {
    const g = createGame(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      CFG,
      42,
      testPool,
      { simple: true },
    );
    // 3 张牌 count 2+1+2=5，5 格全填满
    expect(g.blackMarket.slots.every((s) => s.defId !== null)).toBe(true);
    expect(g.blackMarket.supply.length).toBe(0);
    // 类型随栏位带出
    const subtypes = g.blackMarket.slots.map((s) => s.subtype).sort();
    expect(subtypes).toEqual(["强化芯片", "强化芯片", "道具", "道具", "秘密交易"].sort());
  });

  it("手牌上限加成：handLimitBonus=1 后手牌抽至 7 张", () => {
    // makeGame 返回时 phase=swap（draw 自动推进），换 1 张牌触发 drawToHandLimit
    const g = makeGame();
    const a = g.players[0]!;
    a.handLimitBonus = 1;
    const moving = a.zones.hand[0]!;
    const next = reduce(g, { type: "swap", playerId: "a", discardIds: [moving.id] }, CFG);
    expect(next.players[0]!.zones.hand.length).toBe(7); // 6-1+2(上限7抽到7)
    expect(next.players[1]!.zones.hand.length).toBe(6); // 未操作
  });

  it("换牌次数加成：swapBonus=1 后 swapLeft = 基础+1（第二回合生效）", () => {
    let g = makeGame();
    g.players[0]!.swapBonus = 1;
    g = driveTo(g, "reshape"); // 跑完第一回合
    g = driveTo(g, "swap"); // 第二回合换牌阶段（bonus 已生效）
    const base = g.players[0]!.seat === g.passHolderSeat ? CFG.swapCountWithPass : CFG.swapCount;
    expect(g.players[0]!.swapLeft).toBe(base + 1);
    expect(g.players[1]!.swapLeft).toBe(g.players[1]!.seat === g.passHolderSeat ? CFG.swapCountWithPass : CFG.swapCount);
  });

  it("reshape hooks：进入重整阶段触发 before 效果", () => {
    registerEffect({
      id: "test:reshape-bonus",
      source: "rulebook",
      phase: "reshape",
      timing: "before",
      run: (s) => {
        for (const pl of s.players) pl.chips += 1;
        s.log.push({ turn: s.turn, phase: s.phase, text: "RESHAPE_HOOK_FIRED" });
      },
    });
    const g1 = driveTo(makeGame(), "reshape");
    expect(g1.log.some((l) => l.text === "RESHAPE_HOOK_FIRED")).toBe(true);
  });

  it("swapZero 动作钩子：换牌次数归 0 时触发", () => {
    registerActionHook("test:char", "swapZero", gainChips(1));
    let g = makeGame();
    const a = g.players[0]!;
    a.characterId = "test:char";
    a.swapLeft = 1;
    g.phase = "swap"; // 手动进入换牌阶段
    const chipsBefore = a.chips;
    // 换 1 张牌 → swapLeft 归 0 → 钩子触发
    const moving = a.zones.hand[0]!;
    g = reduce(g, { type: "swap", playerId: "a", discardIds: [moving.id] }, CFG);
    expect(g.players[0]!.chips).toBe(chipsBefore + 1);
    expect(g.players[0]!.swapLeft).toBe(0);
  });
});
