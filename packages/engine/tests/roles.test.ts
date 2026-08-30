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
import { characterPurchasePrice } from "../src/effects/roles.js";
import { deleteCards } from "../src/effects/primitives.js";

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

  it("role:15 特级大厨:换牌弃置 3 每张得 1 血筹", () => {
    let g = makeGame("role:15");
    g = driveTo(g, "swap");
    const a = g.players[0]!;
    a.zones.hand = [card(3, "S", "x1"), card(3, "H", "x2"), card(9, "D", "x3"), card(11, "C", "x4"), card(13, "S", "x5")];
    const before = a.chips;
    g = reduce(g, { type: "swap", playerId: "a", discardIds: ["x1", "x2"] }, CFG);
    expect(g.players[0]!.chips).toBe(before + 2);
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
  // 已真身化故不在本列表：05/07/17（判定视图）、13（重洗钩子）、20（武士结算）、
  // 19（猜特权证）、16（弃出牌区）、18（全牌库删牌）
  const PLACEHOLDER_ROLES = ["role:08"];

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

// ===== 票据 20 批次 2c：reducer 钩子 / 新 Action 型角色（10/11/12/14/15/21）=====
describe("换牌变体角色（票据 20）", () => {
  it("role:10 塔罗师：先抽 2 再弃 2，且消耗 1 次换牌", () => {
    let g = makeGame("role:10");
    g = driveTo(g, "swap");
    const a = g.players[0]!;
    a.zones.hand = [card(2, "S", "p1"), card(5, "H", "p2"), card(9, "D", "p3"), card(11, "C", "p4"), card(13, "S", "p5")];
    a.zones.draw = [card(7, "S", "dr1"), card(8, "H", "dr2")]; // 确定性：抽的必是这两张
    const swapLeftBefore = a.swapLeft;
    g = reduce(g, { type: "swapDrawFirst", playerId: "a", discardIds: ["p1", "p2"] }, CFG);
    const after = g.players[0]!;
    // 先抽 2 再弃 2：净手牌数不变，抽进来的两张留在手里，弃掉的两张进弃牌区
    expect(after.zones.hand.length).toBe(5);
    expect(after.zones.hand.some((c) => c.id === "dr1")).toBe(true);
    expect(after.zones.hand.some((c) => c.id === "dr2")).toBe(true);
    expect(after.zones.discard.some((c) => c.id === "p1")).toBe(true);
    expect(after.swapLeft).toBe(swapLeftBefore - 1);
  });

  it("role:10 塔罗师：非该角色使用先抽后弃会被拒绝", () => {
    let g = makeGame(null);
    g = driveTo(g, "swap");
    expect(() => reduce(g, { type: "swapDrawFirst", playerId: "a", discardIds: [] }, CFG)).toThrow(
      "该角色不支持先抽后弃",
    );
  });

  it("role:14 偶像：一次可弃任意数量，弃 4 张及以上得 1 血筹", () => {
    let g = makeGame("role:14");
    g = driveTo(g, "swap");
    const a = g.players[0]!;
    a.zones.hand = [
      card(2, "S", "q1"),
      card(5, "H", "q2"),
      card(9, "D", "q3"),
      card(11, "C", "q4"),
      card(13, "S", "q5"),
      card(4, "H", "q6"),
    ];
    const before = a.chips;
    g = reduce(g, { type: "swap", playerId: "a", discardIds: ["q1", "q2", "q3", "q4"] }, CFG);
    expect(g.players[0]!.chips).toBe(before + 1);
    // 普通角色一次至多 3 张
    let base = makeGame(null);
    base = driveTo(base, "swap");
    const bp = base.players[0]!;
    expect(() =>
      reduce(base, { type: "swap", playerId: "a", discardIds: bp.zones.hand.slice(0, 4).map((c) => c.id) }, CFG),
    ).toThrow("换牌张数超限");
  });

  it("role:12 炸鸡店老板：花 1 血筹抽 1 张，不消耗换牌次数", () => {
    let g = makeGame("role:12");
    g = driveTo(g, "swap");
    const a = g.players[0]!;
    a.zones.draw.push(card(7, "S", "dr9"));
    const before = a.chips;
    const handBefore = a.zones.hand.length;
    const swapBefore = a.swapLeft;
    g = reduce(g, { type: "buyDraw", playerId: "a" }, CFG);
    expect(g.players[0]!.chips).toBe(before - 1);
    expect(g.players[0]!.zones.hand.length).toBe(handBefore + 1);
    expect(g.players[0]!.swapLeft).toBe(swapBefore);
    // 非该角色不可用
    let base = makeGame(null);
    base = driveTo(base, "swap");
    expect(() => reduce(base, { type: "buyDraw", playerId: "a" }, CFG)).toThrow("该角色不支持付费抽牌");
  });
});

describe("购买与删牌额度角色（票据 20）", () => {
  it("role:11 吉祥物：每回合首次购买半价（向下取整），第二次恢复原价", () => {
    expect(characterPurchasePrice({ characterId: "role:11" } as never, 3)).toBe(1);
    expect(characterPurchasePrice({ characterId: "role:11" } as never, 4)).toBe(2);
    expect(characterPurchasePrice({ characterId: "role:11", purchasedThisTurn: true } as never, 3)).toBe(3);
    expect(characterPurchasePrice({ characterId: "role:11", skillDisabled: true } as never, 3)).toBe(3);
    expect(characterPurchasePrice({ characterId: "role:01" } as never, 3)).toBe(3);
  });

  it("role:11 吉祥物：端到端购买实际只扣半价", () => {
    const spend = (characterId: string | null) => {
      let g = makeGame(characterId);
      g = driveTo(g, "purchase");
      const slot = g.blackMarket.slots[0]!;
      // 无人造卡池时供应堆为空，直接构造一个「备用道具」栏位（买后入道具区，不改血筹）
      slot.defId = "item:test";
      slot.price = 3;
      slot.bonusChips = 0;
      slot.subtype = "备用道具";
      const p = g.players[0]!;
      p.chips = 20;
      const before = p.chips;
      g = reduce(g, { type: "purchase", playerId: "a", slotIndex: 0 }, CFG);
      return before - g.players[0]!.chips;
    };
    expect(spend(null)).toBe(3);
    expect(spend("role:11")).toBe(1);
  });

  it("role:21 黑客：删牌阶段额外免费 1 张（删 2 张不扣筹）", () => {
    const deleteCost = (characterId: string | null, ids: string[]) => {
      let g = makeGame(characterId);
      g = driveTo(g, "delete");
      const p = g.players[0]!;
      p.zones.discard = [card(2, "S", "z1"), card(5, "H", "z2"), card(9, "D", "z3")];
      p.chips = 20;
      const before = p.chips;
      g = reduce(g, { type: "deleteCards", playerId: "a", cardIds: ids }, CFG);
      return before - g.players[0]!.chips;
    };
    expect(deleteCost(null, ["z1", "z2"])).toBe(CFG.deleteChipCost); // 超免费额度 1 张
    expect(deleteCost("role:21", ["z1", "z2"])).toBe(0); // 免费额度 2 张
  });

  it("role:15 特级大厨：任意时候删除 1 张 3 得 4 血筹（覆盖两条删除路径）", () => {
    // 路径一：删牌阶段 Action
    let g = makeGame("role:15");
    g = driveTo(g, "delete");
    const p = g.players[0]!;
    p.zones.discard = [card(3, "S", "y1"), card(3, "H", "y2"), card(9, "D", "y3")];
    p.chips = 20;
    const before = p.chips;
    g = reduce(g, { type: "deleteCards", playerId: "a", cardIds: ["y1", "y2"] }, CFG);
    // 删 2 张：1 张免费 + 1 张付费（deleteChipCost），2 张都是 3 → +8 筹
    expect(g.players[0]!.chips).toBe(before - CFG.deleteChipCost + 8);

    // 路径二：效果原语 deleteCards（黑市牌触发）同样触发奖励
    let g2 = makeGame("role:15");
    const p2 = g2.players[0]!;
    p2.zones.discard = [card(3, "C", "y4")];
    p2.chips = 20;
    const before2 = p2.chips;
    deleteCards(["y4"], { free: 1 })(g2, { config: CFG, playerId: "a", effectId: "test:delete" });
    expect(g2.players[0]!.chips).toBe(before2 + 4);
  });
});

// ===== 票据 20 批次 2d：阶段内交互型角色（19 猜特权证 / 12 结算删牌）=====
/** 让 A 打出四条 A（必胜），B 随机出 5 张，返回"双方已出牌"时的 state */
function bothPlayed(characterId: string, ids: string[]) {
  let g = makeGame(characterId);
  g = driveTo(g, "play");
  const a = g.players[0]!;
  a.zones.hand = [
    card(14, "S", ids[0]!),
    card(14, "H", ids[1]!),
    card(14, "D", ids[2]!),
    card(14, "C", ids[3]!),
    card(2, "S", ids[4]!),
  ];
  g = reduce(g, { type: "playCards", playerId: "a", cardIds: ids }, CFG);
  const b = g.players[1]!;
  g = reduce(g, { type: "playCards", playerId: "b", cardIds: b.zones.hand.slice(0, 5).map((c) => c.id) }, CFG);
  return g;
}

describe("阶段内交互型角色（票据 20）", () => {
  it("role:19 职业赌徒：对决前挂起猜测，判定暂停到猜完才发生", () => {
    const g = bothPlayed("role:19", ["g1", "g2", "g3", "g4", "g5"]);
    expect(g.pendingPrompt?.kind).toBe("choosePlayer");
    expect(g.pendingPrompt?.effectId).toBe("role:19:duel");
    expect(g.duelResult).toEqual([]); // 判定尚未发生（本回合结果为空）
    expect(g.suspended).toEqual({ phase: "duel", step: "beforeDone" });
  });

  it("role:19 职业赌徒：猜对获得（人数+2）血筹", () => {
    const chipOf = (choice: string, characterId: string | null) => {
      let g = characterId ? bothPlayed(characterId, ["g1", "g2", "g3", "g4", "g5"]) : bothPlayed("role:19", ["g1", "g2", "g3", "g4", "g5"]);
      if (!g.pendingPrompt) return null; // 非赌徒：无猜测交互，直接取结算后血筹
      g = reduce(g, { type: "resolvePrompt", playerId: "a", choice }, CFG);
      return g.players[0]!.chips;
    };
    // A 四条 A 必胜 → 特权证归 A；猜 a 得 2+2=4 筹，猜 b 不得
    const right = chipOf("a", "role:19")!;
    const wrong = chipOf("b", "role:19")!;
    expect(right - wrong).toBe(4); // 2 人局：人数 2 + 2 = 4 筹
  });

  it("role:19 职业赌徒：猜测记录写入 declarations 并随回合清空", () => {
    let g = bothPlayed("role:19", ["g1", "g2", "g3", "g4", "g5"]);
    g = reduce(g, { type: "resolvePrompt", playerId: "a", choice: "b" }, CFG);
    expect(g.players[0]!.declarations?.["role:19"]).toBe("b");
    g = driveTo(g, "swap"); // 进入下一回合换牌阶段（resetTurnState 已清 declarations）
    expect(g.players[0]!.declarations?.["role:19"]).toBeUndefined();
  });

  it("role:12 炸鸡店老板：结算末花 1 血筹删 1 张本回合打出的牌", () => {
    let g = bothPlayed("role:12", ["f1", "f2", "f3", "f4", "f5"]);
    // 结算末挂起选牌；候选即本回合打出的牌
    expect(g.pendingPrompt?.kind).toBe("chooseCard");
    expect(g.pendingPrompt?.candidates.sort()).toEqual(["f1", "f2", "f3", "f4", "f5"]);
    const p = g.players[0]!;
    p.chips = 5;
    const before = p.chips;
    g = reduce(g, { type: "resolvePrompt", playerId: "a", choice: ["f1", "f2"] }, CFG);
    expect(g.players[0]!.chips).toBe(before - 2);
    expect(g.players[0]!.zones.deleted.map((c) => c.id)).toEqual(["f1", "f2"]);
    expect(g.pendingPrompt).toBeNull();
  });

  it("role:12 炸鸡店老板：不选牌则不扣费，最多 3 张", () => {
    let g = bothPlayed("role:12", ["f1", "f2", "f3", "f4", "f5"]);
    const p = g.players[0]!;
    p.chips = 5;
    g = reduce(g, { type: "resolvePrompt", playerId: "a", choice: ["f1", "f2", "f3", "f4"] }, CFG);
    expect(g.players[0]!.zones.deleted.map((c) => c.id)).toEqual(["f1", "f2", "f3"]); // 截断到 3 张
    expect(g.players[0]!.chips).toBe(2);
  });
});

describe("两段式交互型角色（票据 20）", () => {
  it("role:16 高中生：弃置出牌区 + 2 筹，续挂选牌删 1 张，判定为高牌 0 点", () => {
    let g = bothPlayed("role:16", ["h1", "h2", "h3", "h4", "h5"]);
    expect(g.pendingPrompt?.kind).toBe("chooseOption");
    const before = g.players[0]!.chips;
    g = reduce(g, { type: "resolvePrompt", playerId: "a", choice: "yes" }, CFG);
    const a = g.players[0]!;
    expect(a.zones.play.length).toBe(0);
    expect(a.chips).toBe(before + 2);
    expect(g.pendingPrompt?.kind).toBe("chooseCard"); // 续挂选牌
    const targetId = a.zones.discard[0]!.id;
    g = reduce(g, { type: "resolvePrompt", playerId: "a", choice: [targetId] }, CFG);
    expect(g.players[0]!.zones.deleted.map((c) => c.id)).toEqual([targetId]);
    const entry = g.duelResult!.find((r) => r.playerId === "a")!;
    expect(entry.category).toBe(1); // 高牌
    expect(entry.totalPoints).toBe(0);
    expect(entry.cards).toEqual([]);
  });

  it("role:16 高中生：选不发动则出牌区保留、不给筹", () => {
    let g = bothPlayed("role:16", ["h1", "h2", "h3", "h4", "h5"]);
    const before = g.players[0]!.chips;
    g = reduce(g, { type: "resolvePrompt", playerId: "a", choice: "no" }, CFG);
    expect(g.players[0]!.chips).toBe(before);
    expect(g.duelResult!.find((r) => r.playerId === "a")!.cards.length).toBe(5);
  });

  it("role:18 清洁工：重整末从全牌库删 1 张，删到抽牌堆的牌则重洗", () => {
    let g = makeGame("role:18");
    g = driveTo(g, "reshape");
    g = reduce(g, { type: "reshape", playerId: "a", reshuffle: false }, CFG);
    g = reduce(g, { type: "reshape", playerId: "b", reshuffle: false }, CFG);
    const prompt = g.pendingPrompt!;
    expect(prompt.kind).toBe("chooseCard");
    expect(prompt.from).toBe("deck");
    const a = g.players[0]!;
    expect(a.zones.draw.length).toBeGreaterThan(0);
    const drawId = a.zones.draw[0]!.id;
    g = reduce(g, { type: "resolvePrompt", playerId: "a", choice: [drawId] }, CFG);
    expect(g.players[0]!.zones.deleted.map((c) => c.id)).toEqual([drawId]);
    expect(g.players[0]!.zones.draw.some((c) => c.id === drawId)).toBe(false);
    expect(g.log.some((l) => l.text.includes("重洗抽牌堆"))).toBe(true);
    expect(g.turn).toBe(2); // 阶段推进在交互完成后继续
  });

  it("role:18 清洁工：不选则不删牌", () => {
    let g = makeGame("role:18");
    g = driveTo(g, "reshape");
    g = reduce(g, { type: "reshape", playerId: "a", reshuffle: false }, CFG);
    g = reduce(g, { type: "reshape", playerId: "b", reshuffle: false }, CFG);
    const before = g.players[0]!.zones.deleted.length;
    g = reduce(g, { type: "resolvePrompt", playerId: "a", choice: [] }, CFG);
    expect(g.players[0]!.zones.deleted.length).toBe(before);
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
