/**
 * 角色牌效果注册单测（票据 11）。
 * 建局注入 characterId: "role:0X" → 推进/触发 → 断言 state 变化与日志。
 * - 4 张简易角色（01/02/03/04）完整用例；
 * - 标准角色已实现效果覆盖（06 矿工 / 09 股民 / 15 特级大厨部分）；
 * - 交互/机制缺失角色占位验证（不抛错 + 日志降级提示）。
 */
import { describe, it, expect } from "vitest";
import { createGame, reduce } from "../src/game/whiteboard.js";
import { DEFAULT_GAME_CONFIG } from "../src/core/config.js";
import { card } from "../src/cards.js";
import type { GameState } from "../src/core/state.js";

const CFG = DEFAULT_GAME_CONFIG;

function makeGame(characterId: string | null): GameState {
  const infos = characterId
    ? [
        { id: "a", name: "A", characterId },
        { id: "b", name: "B" },
      ]
    : [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ];
  return createGame(infos, CFG, 42);
}

/** 傻瓜策略自动推进到指定阶段（参考 infra.test.ts 的 driveTo） */
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

describe("roleSetup(游戏开始常驻效果)", () => {
  it("role:01 赌场荷官:对决总点数 +20(duelPointsBonus)", () => {
    const g = makeGame("role:01");
    expect(g.players[0]!.duelPointsBonus).toBe(20);
    // 推进一整回合（含对决/结算）不抛错，结算正常
    const g2 = driveTo(g, "reshape");
    expect(g2.players[0]!.zones.play.length).toBe(0);
    expect(g2.log.some((l) => l.text.includes("第1名"))).toBe(true);
  });

  it("role:02 银行职员:游戏开始额外 2 血筹", () => {
    const base = makeGame(null);
    const g = makeGame("role:02");
    expect(g.players[0]!.chips).toBe(base.players[0]!.chips + 2);
  });

  it("role:03 魔术师:手牌上限 +1,换牌后抽至 7 张", () => {
    const g = makeGame("role:03");
    const a = g.players[0]!;
    expect(a.handLimitBonus).toBe(1);
    const moving = a.zones.hand[0]!;
    const next = reduce(g, { type: "swap", playerId: "a", discardIds: [moving.id] }, CFG);
    expect(next.players[0]!.zones.hand.length).toBe(7);
  });

  it("role:04 酒保:换牌次数 +1", () => {
    const g = makeGame("role:04");
    const a = g.players[0]!;
    expect(a.swapBonus).toBe(1);
    const base = a.seat === g.passHolderSeat ? CFG.swapCountWithPass : CFG.swapCount;
    expect(a.swapLeft).toBe(base + 1);
  });

  it("role:05 / role:21 setup 占位:开局日志降级提示", () => {
    for (const roleId of ["role:05", "role:21"]) {
      const g = makeGame(roleId);
      expect(g.log.some((l) => l.text.includes(`效果未实现: setup:${roleId}`))).toBe(true);
    }
  });
});

describe("EffectDef 阶段效果", () => {
  it("role:02 银行职员:重整阶段获得 2 血筹", () => {
    let g = makeGame("role:02");
    g = driveTo(g, "delete"); // 进入删牌阶段（reshape before 尚未触发）
    const chipsBefore = g.players[0]!.chips;
    g = driveTo(g, "reshape"); // 全员 ready → 进入 reshape → before hooks → +2
    expect(g.players[0]!.chips).toBe(chipsBefore + 2);
  });

  it("role:06 矿工:对决打出全黑牌 +3", () => {
    let g = makeGame("role:06");
    g = driveTo(g, "play");
    const a = g.players[0]!;
    // 直接构造全黑手牌（♠/♣），playCards 后推进对决（自动结算，可能发名次奖）
    a.zones.hand = [card(2, "S", "b1"), card(5, "C", "b2"), card(9, "S", "b3"), card(11, "C", "b4"), card(13, "S", "b5")];
    g = reduce(g, { type: "playCards", playerId: "a", cardIds: ["b1", "b2", "b3", "b4", "b5"] }, CFG);
    const b = g.players[1]!;
    g = reduce(g, { type: "playCards", playerId: "b", cardIds: b.zones.hand.slice(0, 5).map((c) => c.id) }, CFG);
    expect(g.log.some((l) => l.text.includes("A 获得 3 血筹"))).toBe(true);
  });

  it("role:06 矿工:非全黑不触发", () => {
    let g = makeGame("role:06");
    g = driveTo(g, "play");
    const a = g.players[0]!;
    // 构造非全黑手牌（♥/♦），矿工效果不应触发
    a.zones.hand = [card(3, "H", "r1"), card(6, "D", "r2"), card(8, "H", "r3"), card(10, "D", "r4"), card(12, "H", "r5")];
    g = reduce(g, { type: "playCards", playerId: "a", cardIds: ["r1", "r2", "r3", "r4", "r5"] }, CFG);
    const b = g.players[1]!;
    g = reduce(g, { type: "playCards", playerId: "b", cardIds: b.zones.hand.slice(0, 5).map((c) => c.id) }, CFG);
    expect(g.log.some((l) => l.text.includes("A 获得 3 血筹"))).toBe(false);
  });

  it("role:09 股民:购买阶段结束 0 血筹时 +3", () => {
    let g = makeGame("role:09");
    g = driveTo(g, "purchase");
    g.players[0]!.chips = 0;
    g = driveTo(g, "delete"); // 全员 skipPurchase → endPurchasePhase(after) → +3
    expect(g.players[0]!.chips).toBe(3);
  });

  it("role:15 特级大厨:对决阶段每打出 1 张 3 获得 1 血筹", () => {
    let g = makeGame("role:15");
    g = driveTo(g, "play");
    const a = g.players[0]!;
    // 构造含 3 张 3 的出牌，对决推进后每张 3 得 1 筹
    a.zones.hand = [card(3, "S", "t1"), card(3, "H", "t2"), card(3, "D", "t3"), card(5, "S", "f1"), card(7, "H", "f2")];
    g = reduce(g, { type: "playCards", playerId: "a", cardIds: ["t1", "t2", "t3", "f1", "f2"] }, CFG);
    const b = g.players[1]!;
    g = reduce(g, { type: "playCards", playerId: "b", cardIds: b.zones.hand.slice(0, 5).map((c) => c.id) }, CFG);
    expect(g.log.some((l) => l.text.includes("A 获得 3 血筹"))).toBe(true);
  });

  it("role:15 特级大厨:换牌弃 3 得筹未实现(占位日志)", () => {
    let g = makeGame("role:15");
    g = driveTo(g, "play"); // 经过换牌阶段 → swap after 占位触发
    expect(g.log.some((l) => l.text.includes("效果未实现: role:15:swap"))).toBe(true);
  });
});

describe("动作钩子(swapZero)", () => {
  it("role:04 酒保:剩余换牌次数归 0 时获得 1 血筹", () => {
    const g = makeGame("role:04");
    const a = g.players[0]!;
    a.swapLeft = 1;
    const before = a.chips;
    const moving = a.zones.hand[0]!;
    const next = reduce(g, { type: "swap", playerId: "a", discardIds: [moving.id] }, CFG);
    expect(next.players[0]!.chips).toBe(before + 1);
    expect(next.players[0]!.swapLeft).toBe(0);
  });
});

describe("占位效果降级", () => {
  // 交互/机制缺失的角色：仅验证「不抛错 + 日志提示」（占位降级约定，不阻塞）
  // 已真身化的角色（05/07/17 判定视图、13 重洗钩子、20 武士）不在本列表，见下方真身用例
  const PLACEHOLDER_ROLES = [
    "role:08",
    "role:10",
    "role:11",
    "role:12",
    "role:14",
    "role:16",
    "role:18",
    "role:19",
    "role:21",
  ];

  it("占位角色:推进一整回合不抛错且日志降级提示", () => {
    for (const roleId of PLACEHOLDER_ROLES) {
      let g = makeGame(roleId);
      expect(() => {
        g = driveTo(g, "reshape");
        g = driveTo(g, "swap"); // 触发 reshape after(endTurn)，覆盖 role:18 等 after 型占位
      }).not.toThrow();
      expect(g.log.some((l) => l.text.includes("效果未实现"))).toBe(true);
    }
  });
});

// ===== 票据 20：判定视图型角色真身（05/07/17）与结算型（13/20）=====
/** 替换 A 的手牌为指定牌并推进到结算阶段，返回结算后 state 与对决前血筹 */
function duelWith(characterId: string | null, cards: ReturnType<typeof card>[]) {
  let g = makeGame(characterId);
  g = driveTo(g, "play");
  const a = g.players[0]!;
  a.zones.hand = [...cards];
  const chipsBefore = a.chips;
  g = reduce(g, { type: "playCards", playerId: "a", cardIds: cards.map((c) => c.id) }, CFG);
  const b = g.players[1]!;
  g = reduce(g, { type: "playCards", playerId: "b", cardIds: b.zones.hand.slice(0, 5).map((c) => c.id) }, CFG);
  return { state: g, chipsBefore };
}

describe("判定视图型角色（票据 20）", () => {
  it("role:05 特型演员：2 视为 5，一对 5 变三条 5", () => {
    const hand = [card(2, "S", "a1"), card(5, "H", "a2"), card(5, "D", "a3"), card(7, "C", "a4"), card(9, "S", "a5")];
    const base = duelWith(null, hand);
    const hero = duelWith("role:05", hand);
    expect(base.state.duelResult![0]!.category).toBe(2); // 一对
    expect(hero.state.duelResult![0]!.category).toBe(4); // 三条
    expect(hero.state.duelResult![0]!.cards.find((c) => c.id === "a1")!.rank).toBe(5);
  });

  it("role:07 杂技演员：6 视为 9，一对 9 变三条 9", () => {
    const hand = [card(6, "S", "b1"), card(9, "H", "b2"), card(9, "D", "b3"), card(3, "C", "b4"), card(2, "S", "b5")];
    const base = duelWith(null, hand);
    const hero = duelWith("role:07", hand);
    expect(base.state.duelResult![0]!.category).toBe(2);
    expect(hero.state.duelResult![0]!.category).toBe(4);
    expect(hero.state.duelResult![0]!.cards.find((c) => c.id === "b1")!.rank).toBe(9);
  });

  it("role:17 枪手：4 视为小丑造五条，结算后删除视为小丑的 4", () => {
    const hand = [card(4, "S", "c1"), card(4, "H", "c2"), card(9, "S", "c3"), card(9, "H", "c4"), card(9, "D", "c5")];
    const base = duelWith(null, hand);
    const hero = duelWith("role:17", hand);
    expect(base.state.duelResult![0]!.category).toBe(7); // 葫芦
    expect(hero.state.duelResult![0]!.category).toBe(10); // 五条（两张 4 均赋 9）
    const a = hero.state.players[0]!;
    expect(a.zones.deleted.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(a.zones.discard.some((c) => c.rank === 4)).toBe(false);
  });
});

describe("结算型角色（票据 20）", () => {
  it("role:13 洗衣房店主：不重洗额外 2 血筹 / 重洗得 1 血筹", () => {
    const noReshuffle = (characterId: string | null) => {
      let g = makeGame(characterId);
      g = driveTo(g, "reshape");
      const before = g.players[0]!.chips;
      g = reduce(g, { type: "reshape", playerId: "a", reshuffle: false }, CFG);
      return g.players[0]!.chips - before;
    };
    const doReshuffle = (characterId: string | null) => {
      let g = makeGame(characterId);
      g = driveTo(g, "reshape");
      const before = g.players[0]!.chips;
      g = reduce(g, { type: "reshape", playerId: "a", reshuffle: true }, CFG);
      return g.players[0]!.chips - before;
    };
    expect(noReshuffle(null)).toBe(CFG.reshuffleOrChips);
    expect(noReshuffle("role:13")).toBe(CFG.reshuffleOrChips + 2);
    expect(doReshuffle(null)).toBe(0);
    expect(doReshuffle("role:13")).toBe(1);
  });

  it("role:20 武士：按本回合获得的车票额外获得血筹", () => {
    const strong = [card(14, "S", "d1"), card(14, "H", "d2"), card(14, "D", "d3"), card(14, "C", "d4"), card(2, "S", "d5")];
    const base = duelWith(null, strong);
    const hero = duelWith("role:20", strong);
    const baseGain = base.state.players[0]!.chips - base.chipsBefore;
    const heroGain = hero.state.players[0]!.chips - hero.chipsBefore;
    expect(base.state.players[0]!.ticketsGainedThisTurn).toBe(4); // 2 人局第 1 名 4 票
    expect(heroGain).toBe(baseGain + 4);
  });
});
