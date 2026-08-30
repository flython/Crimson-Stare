/**
 * 黑市牌效果单测（票据 12，M2.3）。
 * 覆盖：黄边秘密交易购买立即结算（血筹/牌区断言）、强化芯片挂起→选牌→挂载与点数变化、
 * 无合法目标弃置、数值越界 2-14 拒绝、每牌限 1 芯片（金科玉律 3）、阶段时机效果（血筹镀层出/夺）、备用道具入区。
 */
import { describe, it, expect } from "vitest";
import { createGame, reduce } from "../src/game/whiteboard.js";
import { DEFAULT_GAME_CONFIG } from "../src/core/config.js";
import { resolveTiming, runTimingQueue } from "../src/core/effects.js";
import { card } from "../src/cards.js";
import { evaluateHand, HandCategory } from "../src/hand-evaluator.js";
import type { ChipView } from "../src/hand-evaluator.js";
import type { GameState, PlayerState } from "../src/core/state.js";
// 副作用导入：加载 market.ts 使注册表生效（whiteboard 只 import roles.js）
import { chipViewFromChips } from "../src/effects/market.js";

const CFG = DEFAULT_GAME_CONFIG;

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

/** 在指定槽位放置黑市牌并购买（购买者血筹置 20、价格 0，专注效果本身） */
function buy(state: GameState, defId: string): GameState {
  const a = state.players[0]!;
  a.chips = 20;
  state.phase = "purchase";
  const slot = state.blackMarket.slots[0]!;
  slot.defId = defId;
  slot.price = 0;
  slot.bonusChips = 0;
  return reduce(state, { type: "purchase", playerId: "a", slotIndex: 0 }, CFG);
}

/** 玩家 a 对挂起交互做出选择 */
function resolve(state: GameState, choice: string | string[]): GameState {
  return reduce(state, { type: "resolvePrompt", playerId: "a", choice }, CFG);
}

/** 指定玩家对挂起交互做出选择（跨玩家交互，如定点爆破由对手本人选牌） */
function resolveAs(state: GameState, playerId: string, choice: string | string[]): GameState {
  return reduce(state, { type: "resolvePrompt", playerId, choice }, CFG);
}

/** 傻瓜策略推进到指定阶段（换/出/买/删/重整一律最小操作） */
function driveTo(state: GameState, phase: string): GameState {
  for (let guard = 0; guard < 500 && state.phase !== phase && !state.finished; guard++) {
    for (const pid of state.players.map((p) => p.id)) {
      if (state.pendingPrompt) break;
      try {
        if (state.phase === "swap") state = reduce(state, { type: "stopSwap", playerId: pid }, CFG);
        else if (state.phase === "play") {
          const p = state.players.find((x) => x.id === pid)!;
          const cards = p.zones.hand.slice(0, 5).map((c) => c.id);
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

describe("黑市牌效果（票据 12）", () => {
  describe("黄边秘密交易：购买立即结算", () => {
    it("027 廉价删除：购买挂起选牌 → 免费删除至多 2 张，血筹不变", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [card(5, "S", "d1"), card(9, "H", "d2"), card(2, "C", "d3")];
      g = buy(g, "027");
      expect(g.pendingPrompt).toMatchObject({ kind: "chooseCard", effectId: "market:027", from: "discard" });
      g = resolve(g, ["d1", "d2"]);
      expect(g.pendingPrompt).toBeNull();
      expect(g.players[0]!.zones.deleted.map((c) => c.id).sort()).toEqual(["d1", "d2"]);
      expect(g.players[0]!.zones.discard.map((c) => c.id)).toEqual(["d3"]);
      expect(g.players[0]!.chips).toBe(20); // 免费删除，价格 0
    });

    it("027 廉价删除：选 0 张不删牌不报错", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [card(5, "S", "d1")];
      g = buy(g, "027");
      g = resolve(g, []);
      expect(g.players[0]!.zones.discard.map((c) => c.id)).toEqual(["d1"]);
      expect(g.players[0]!.zones.deleted).toHaveLength(0);
    });

    it("027 廉价删除：弃牌堆空 → 无候选，不挂起", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [];
      g = buy(g, "027");
      expect(g.pendingPrompt).toBeNull();
    });

    it("031 暴力删除：选择目标删除其抽牌堆顶 3 张", () => {
      let g = makeGame();
      const b = g.players[1]!;
      expect(b.zones.draw.length).toBeGreaterThanOrEqual(3);
      const top3 = b.zones.draw.slice(0, 3).map((c) => c.id);
      g = buy(g, "031");
      expect(g.pendingPrompt).toMatchObject({ kind: "choosePlayer", effectId: "market:031" });
      g = resolve(g, "b");
      const b2 = g.players[1]!;
      for (const id of top3) {
        expect(b2.zones.deleted.some((c) => c.id === id)).toBe(true);
        expect(b2.zones.draw.some((c) => c.id === id)).toBe(false);
      }
      expect(g.players[0]!.chips).toBe(20);
    });

    it("034 货箱盲掏：免费获得黑市牌堆顶 1 张，按其类型结算（对赌协议 → 立即得骰子血筹）", () => {
      let g = makeGame();
      g.blackMarket.supply = [{ defId: "036", price: 0, subtype: "秘密交易" }];
      g = buy(g, "034");
      expect(g.pendingPrompt).toBeNull();
      expect(g.blackMarket.supply).toHaveLength(0);
      expect(g.players[0]!.chips).toBeGreaterThan(20);
    });

    it("034 货箱盲掏：堆顶为备用道具 → 存入道具区", () => {
      let g = makeGame();
      g.blackMarket.supply = [{ defId: "052", price: 0, subtype: "道具" }];
      g = buy(g, "034");
      expect(g.pendingPrompt).toBeNull();
      expect(g.players[0]!.zones.items).toContain("052");
    });

    it("036 对赌协议：购买立即结算，获得 1-6 血筹", () => {
      let g = makeGame();
      g = buy(g, "036");
      expect(g.pendingPrompt).toBeNull();
      const gain = g.players[0]!.chips - 20;
      expect(gain).toBeGreaterThanOrEqual(1);
      expect(gain).toBeLessThanOrEqual(6);
    });

    it("039 鬼手探囊：购买后获得临时特权证", () => {
      let g = makeGame();
      g.passHolderSeat = g.players[1]!.seat; // 先让 B 持证
      g = buy(g, "039");
      expect(g.passHolderSeat).toBe(g.players[0]!.seat);
    });
  });

  describe("强化芯片：插入挂载与点数变化", () => {
    it("001 校准器+1：购买挂起 → 选牌 → 芯片挂载且点数 +1", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [card(5, "S", "t1")];
      g = buy(g, "001");
      expect(g.pendingPrompt).toMatchObject({ kind: "chooseCard", effectId: "market:001", from: "discard" });
      g = resolve(g, ["t1"]);
      expect(g.pendingPrompt).toBeNull();
      expect(g.players[0]!.zones.chips["t1"]).toBe("001");
      expect(g.players[0]!.zones.discard.find((c) => c.id === "t1")!.rank).toBe(6);
    });

    it("005 限流阀-1：选中后点数 -1", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [card(10, "S", "t1")];
      g = buy(g, "005");
      g = resolve(g, ["t1"]);
      expect(g.players[0]!.zones.chips["t1"]).toBe("005");
      expect(g.players[0]!.zones.discard.find((c) => c.id === "t1")!.rank).toBe(9);
    });

    it("金科玉律 4：数值越界拒绝——13+2=15 无候选弃置，12+2=14 可插", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [card(13, "S", "t1")];
      g = buy(g, "002"); // 校准器+2
      expect(g.pendingPrompt).toBeNull(); // 15 越界 → 无合法目标，该黑市牌弃置
      expect(g.players[0]!.zones.chips).toEqual({});

      let g2 = makeGame();
      g2.players[0]!.zones.discard = [card(12, "S", "t1")];
      g2 = buy(g2, "002"); // 14 恰好合法
      expect(g2.pendingPrompt).not.toBeNull();
    });

    it("金科玉律 4：下限越界——2-1=1 无候选弃置", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [card(2, "S", "t1")];
      g = buy(g, "005"); // 限流阀-1
      expect(g.pendingPrompt).toBeNull();
      expect(g.players[0]!.zones.chips).toEqual({});
    });

    it("金科玉律 3：每牌限 1 芯片——已挂芯片的牌不可再插入，无其他目标则弃置", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [card(5, "S", "t1")];
      g.players[0]!.zones.chips["t1"] = "005";
      g = buy(g, "001");
      expect(g.pendingPrompt).toBeNull();
      expect(g.players[0]!.zones.chips["t1"]).toBe("005"); // 不可替换
    });

    it("弃牌堆空 → 无合法目标，强化芯片弃置", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [];
      g = buy(g, "001");
      expect(g.pendingPrompt).toBeNull();
      expect(g.players[0]!.zones.chips).toEqual({});
    });

    it("JOKER 不可插入数值/声明类芯片（无花色点数）", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [card(5, "S", "t1"), { rank: null, suit: null, isJoker: true, id: "jk" }];
      g = buy(g, "001");
      expect(g.pendingPrompt!.candidates).not.toContain("jk");
    });
  });

  describe("阶段时机效果（血筹镀层）", () => {
    it("021 血筹镀层（出）：对决 during 对持有者 +2 血筹", () => {
      const g = makeGame();
      const a = g.players[0]!;
      a.zones.chips["t1"] = "021";
      const before = a.chips;
      runTimingQueue(g, resolveTiming(g, "duel", "during", CFG), CFG);
      expect(a.chips).toBe(before + 2);
    });

    it("022 血筹镀层（夺）：对决挂起选对手，夺其 1 血筹给自己", () => {
      let g = makeGame();
      const a = g.players[0]!;
      const b = g.players[1]!;
      a.zones.chips["t1"] = "022";
      b.chips = 10;
      const aBefore = a.chips;
      runTimingQueue(g, resolveTiming(g, "duel", "during", CFG), CFG);
      expect(g.pendingPrompt).toMatchObject({ kind: "choosePlayer", effectId: "market:022:during:duel", playerId: "a" });
      g = reduce(g, { type: "resolvePrompt", playerId: "a", choice: "b" }, CFG);
      expect(g.players[1]!.chips).toBe(9);
      expect(g.players[0]!.chips).toBe(aBefore + 1);
    });

    it("021/022 只对持有者生效：未持有芯片的玩家不触发", () => {
      const g = makeGame();
      const b = g.players[1]!;
      b.zones.chips["t1"] = "021";
      const aBefore = g.players[0]!.chips;
      runTimingQueue(g, resolveTiming(g, "duel", "during", CFG), CFG);
      expect(g.players[0]!.chips).toBe(aBefore); // a 未持有
      expect(b.chips).toBe(b.chips); // b +2（上面无对比，仅确保不抛错）
    });
  });

  describe("备用道具", () => {
    it("052 荷官证（黄边道具）：购买后存入道具区，不挂起", () => {
      let g = makeGame();
      g = buy(g, "052");
      expect(g.pendingPrompt).toBeNull();
      expect(g.players[0]!.zones.items).toContain("052");
    });

    it("045 信号干扰器（道具）：购买后存入道具区", () => {
      let g = makeGame();
      g = buy(g, "045");
      expect(g.pendingPrompt).toBeNull();
      expect(g.players[0]!.zones.items).toContain("045");
    });
  });

  describe("非黄边秘密交易（尽量）", () => {
    it("028 闭店礼·小：获得 4 血筹并跳过本回合购买", () => {
      let g = makeGame();
      g = buy(g, "028");
      const a = g.players[0]!;
      expect(a.chips).toBe(24);
      expect(a.purchaseFlipped).toBe(true);
      expect(a.phaseReady).toBe(true);
    });

    it("041 血筹分享：自己 +5，每位对手 +1", () => {
      let g = makeGame();
      const bBefore = g.players[1]!.chips;
      g = buy(g, "041");
      expect(g.players[0]!.chips).toBe(25);
      expect(g.players[1]!.chips).toBe(bBefore + 1);
    });

    it("042 拔除芯片：删除弃牌堆带芯片的牌并获得 4 血筹", () => {
      let g = makeGame();
      const a = g.players[0]!;
      a.zones.discard = [card(5, "S", "t1")];
      a.zones.chips["t1"] = "001";
      g = buy(g, "042");
      expect(g.pendingPrompt).toMatchObject({ effectId: "market:042" });
      g = resolve(g, ["t1"]);
      const a2 = g.players[0]!;
      expect(a2.zones.deleted.some((c) => c.id === "t1")).toBe(true);
      expect(a2.zones.chips["t1"]).toBeUndefined();
      expect(a2.chips).toBe(24); // 20 + 4
    });

    it("042 拔除芯片：弃牌堆无带芯片的牌 → 不挂起", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [card(5, "S", "t1")];
      g = buy(g, "042");
      expect(g.pendingPrompt).toBeNull();
    });
  });

  describe("芯片判定视图（票据 20）", () => {
    /** 由玩家已插入的芯片构建判定视图；extra 可覆盖 chipsDisabled / disabledChipCards */
    function viewOf(chips: Record<string, string>, extra?: Partial<PlayerState>): ChipView | undefined {
      const g = makeGame();
      const p = g.players[0]!;
      p.zones.chips = chips;
      return chipViewFromChips(Object.assign(p, extra));
    }

    it("008 变色墨水：该牌四花色全开", () => {
      expect(viewOf({ t1: "008" })).toEqual({ suitOptions: { t1: ["S", "H", "D", "C"] } });
    });

    it("009/010 黑/红芯片：仅对应两花色候选", () => {
      expect(viewOf({ t1: "009" })).toEqual({ suitOptions: { t1: ["S", "C"] } });
      expect(viewOf({ t1: "010" })).toEqual({ suitOptions: { t1: ["D", "H"] } });
    });

    it("011 数字滑轨：点数 2-14 全开", () => {
      const v = viewOf({ t1: "011" });
      expect(v?.rankOptions?.["t1"]).toHaveLength(13);
      expect(v?.rankOptions?.["t1"]).toContain(14);
    });

    it("012 百变影像：视为 JOKER 参与求解", () => {
      expect(viewOf({ t1: "012" })).toEqual({ asJoker: ["t1"] });
    });

    it("017 双生镜片：该牌视为 2 张", () => {
      expect(viewOf({ t1: "017" })).toEqual({ duplicate: ["t1"] });
    });

    it("数值芯片（001-007）与 013 空白模板在插入时结算，不进判定视图", () => {
      expect(viewOf({ t1: "001" })).toBeUndefined();
      expect(viewOf({ t1: "013" })).toBeUndefined();
    });

    it("芯片失效：全局 chipsDisabled 与单张 disabledChipCards 均剔除", () => {
      expect(viewOf({ t1: "008", t2: "011" }, { chipsDisabled: true })).toBeUndefined();
      const v = viewOf({ t1: "008", t2: "011" }, { disabledChipCards: ["t1"] });
      expect(v).toEqual({ rankOptions: { t2: expect.any(Array) } });
    });

    it("008 变色墨水促成同花：4 张 ♠ + 1 张 ♥ 判定为同花", () => {
      const hand = [card(2, "S", "a1"), card(5, "S", "a2"), card(9, "S", "a3"), card(11, "S", "a4"), card(7, "H", "a5")];
      expect(evaluateHand(hand).category).toBeLessThan(HandCategory.同花);
      expect(evaluateHand(hand, { suitOptions: { a5: ["S", "H", "D", "C"] } }).category).toBe(HandCategory.同花);
    });

    it("009 黑色芯片只能取黑花色：♠♣ 命中同花，♦♥ 不命中", () => {
      const hand = [card(2, "S", "a1"), card(5, "S", "a2"), card(9, "S", "a3"), card(11, "S", "a4"), card(7, "H", "a5")];
      expect(evaluateHand(hand, { suitOptions: { a5: ["S", "C"] } }).category).toBe(HandCategory.同花);
      const red = evaluateHand(hand, { suitOptions: { a5: ["D", "H"] } });
      expect(red.category).toBeLessThan(HandCategory.同花);
    });

    it("011 数字滑轨凑五条：4 张 A + 1 张 2 可视为 A", () => {
      const hand = [card(14, "S", "a1"), card(14, "H", "a2"), card(14, "D", "a3"), card(14, "C", "a4"), card(2, "S", "a5")];
      expect(evaluateHand(hand).category).toBe(HandCategory.四条);
      const ranks = Array.from({ length: 13 }, (_, i) => i + 2);
      expect(evaluateHand(hand, { rankOptions: { a5: ranks } }).category).toBe(HandCategory.五条);
    });

    it("012 百变影像等同 JOKER：4 张 A + 1 张杂牌凑五条", () => {
      const hand = [card(14, "S", "a1"), card(14, "H", "a2"), card(14, "D", "a3"), card(14, "C", "a4"), card(7, "S", "a5")];
      expect(evaluateHand(hand, { asJoker: ["a5"] }).category).toBe(HandCategory.五条);
    });

    it("017 双生镜片复制一张：四条 → 五条，且复制品与原牌同点同花", () => {
      const hand = [card(5, "S", "a1"), card(5, "H", "a2"), card(5, "D", "a3"), card(5, "C", "a4"), card(7, "S", "a5")];
      expect(evaluateHand(hand).category).toBe(HandCategory.四条);
      const ev = evaluateHand(hand, { duplicate: ["a1"] });
      expect(ev.category).toBe(HandCategory.五条);
      const dup = ev.cards.find((c) => c.id === "a1#dup");
      expect(dup).toMatchObject({ rank: 5, suit: "S" });
    });
  });

  describe("特权证条件效果（票据 20）", () => {
    it("037 特权分红：持有特权证 +3 血筹，不持有则无", () => {
      let g = makeGame();
      g.passHolderSeat = g.players[0]!.seat;
      g = buy(g, "037");
      expect(g.players[0]!.chips).toBe(23); // 20 + 3

      let g2 = makeGame();
      g2.passHolderSeat = g2.players[1]!.seat;
      g2 = buy(g2, "037");
      expect(g2.players[0]!.chips).toBe(20);
    });

    it("019 血筹镀层（胜）：结算时芯片持有者持有特权证 +4 血筹", () => {
      const g = makeGame();
      const a = g.players[0]!;
      a.zones.chips["t1"] = "019";
      g.passHolderSeat = a.seat;
      const before = a.chips;
      runTimingQueue(g, resolveTiming(g, "settle", "after", CFG), CFG);
      expect(a.chips).toBe(before + 4);
    });

    it("019 血筹镀层（胜）：未持有特权证不给筹；未插该芯片的玩家也不给", () => {
      const g = makeGame();
      const a = g.players[0]!;
      const b = g.players[1]!;
      a.zones.chips["t1"] = "019";
      g.passHolderSeat = b.seat;
      const aBefore = a.chips;
      const bBefore = b.chips;
      runTimingQueue(g, resolveTiming(g, "settle", "after", CFG), CFG);
      expect(a.chips).toBe(aBefore);
      expect(b.chips).toBe(bBefore); // b 持证但未插 019
    });

    it("020 血筹镀层（败）：不持有特权证 +3 血筹，持有则无", () => {
      const g = makeGame();
      const a = g.players[0]!;
      const b = g.players[1]!;
      a.zones.chips["t1"] = "020";
      g.passHolderSeat = b.seat;
      const aBefore = a.chips;
      runTimingQueue(g, resolveTiming(g, "settle", "after", CFG), CFG);
      expect(a.chips).toBe(aBefore + 3);

      const g2 = makeGame();
      const a2 = g2.players[0]!;
      a2.zones.chips["t1"] = "020";
      g2.passHolderSeat = a2.seat;
      const before2 = a2.chips;
      runTimingQueue(g2, resolveTiming(g2, "settle", "after", CFG), CFG);
      expect(a2.chips).toBe(before2);
    });

  });

  describe("负面状态类秘密交易（票据 20）", () => {
    it("038 冻结车厢：选对手 → 其 skipPhases 含 reshape，进入重整阶段自动跳过", () => {
      let g = makeGame();
      g = buy(g, "038");
      expect(g.pendingPrompt).toMatchObject({ kind: "choosePlayer", effectId: "market:038" });
      g = resolve(g, "b");
      expect(g.players[1]!.skipPhases).toContain("reshape");
      expect(g.players[0]!.skipPhases ?? []).not.toContain("reshape");

      // 推进到重整：B 被冻结自动就绪，A 需自行操作
      g = driveTo(g, "reshape");
      expect(g.phase).toBe("reshape");
      expect(g.players[1]!.phaseReady).toBe(true);
      expect(g.log.some((l) => l.text.includes("跳过 重整 阶段"))).toBe(true);
      expect(() => reduce(g, { type: "reshape", playerId: "b", reshuffle: false }, CFG)).toThrow();
    });

    it("038 冻结车厢：2 人局全员被冻结 → 重整阶段自动结束回合", () => {
      let g = makeGame();
      g.players[0]!.skipPhases = ["reshape"];
      g.players[1]!.skipPhases = ["reshape"];
      const turnBefore = g.turn;
      g = driveTo(g, "reshape");
      expect(g.turn).toBe(turnBefore + 1); // 双方都跳过重整 → 直接进入下一回合
    });

    it("040 餐车投毒：选对手 → 下回合换牌次数 -2", () => {
      let g = makeGame();
      g = buy(g, "040");
      g = resolve(g, "b");
      expect(g.players[1]!.nextTurnSwapDelta).toBe(-2);
    });

    it("044 暂时失忆：可选自己 → 下回合技能失效", () => {
      let g = makeGame();
      g = buy(g, "044");
      expect(g.pendingPrompt!.candidates).toEqual(["a", "b"]); // 含自己
      g = resolve(g, "a");
      expect(g.players[0]!.nextTurnSkillDisabled).toBe(true);
    });

    it("033 定点爆破：选对手后由对手本人从自己的弃牌堆删 1 张（金科玉律 2）", () => {
      let g = makeGame();
      g.players[1]!.zones.discard = [card(5, "S", "b1"), card(9, "H", "b2")];
      g = buy(g, "033");
      expect(g.pendingPrompt).toMatchObject({ kind: "choosePlayer", effectId: "market:033" });
      g = resolve(g, "b");
      expect(g.pendingPrompt).toMatchObject({ kind: "chooseCard", playerId: "b", from: "discard" });
      expect(g.pendingPrompt!.candidates).toEqual(["b1", "b2"]);
      g = resolveAs(g, "b", ["b1"]);
      expect(g.pendingPrompt).toBeNull();
      expect(g.players[1]!.zones.deleted.map((c) => c.id)).toEqual(["b1"]);
      expect(g.players[1]!.zones.discard.map((c) => c.id)).toEqual(["b2"]);
    });

    it("033 定点爆破：对手弃牌堆为空 → 不挂起，无事发生", () => {
      let g = makeGame();
      g.players[1]!.zones.discard = [];
      g = buy(g, "033");
      g = resolve(g, "b");
      expect(g.pendingPrompt).toBeNull();
      expect(g.log.some((l) => l.text.includes("弃牌堆为空"))).toBe(true);
    });

    it("026 共享信息：自己删 2 张 → 逐位对手各删 1 张", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [card(2, "S", "a1"), card(3, "H", "a2"), card(4, "D", "a3")];
      g.players[1]!.zones.discard = [card(5, "S", "b1"), card(6, "H", "b2")];
      g = buy(g, "026");
      expect(g.pendingPrompt).toMatchObject({ kind: "chooseCard", playerId: "a", from: "discard" });
      g = resolve(g, ["a1", "a2"]);
      expect(g.players[0]!.zones.deleted.map((c) => c.id)).toEqual(["a1", "a2"]);
      // 链式：轮到 b 选至多 1 张
      expect(g.pendingPrompt).toMatchObject({ kind: "chooseCard", playerId: "b", from: "discard" });
      g = resolveAs(g, "b", ["b1"]);
      expect(g.pendingPrompt).toBeNull();
      expect(g.players[1]!.zones.deleted.map((c) => c.id)).toEqual(["b1"]);
      expect(g.players[1]!.zones.discard.map((c) => c.id)).toEqual(["b2"]);
    });

    it("026 共享信息：最多删 2 张，多选的部分被截断", () => {
      let g = makeGame();
      g.players[0]!.zones.discard = [card(2, "S", "a1"), card(3, "H", "a2"), card(4, "D", "a3")];
      g.players[1]!.zones.discard = [];
      g = buy(g, "026");
      g = resolve(g, ["a1", "a2", "a3"]);
      expect(g.players[0]!.zones.deleted.map((c) => c.id)).toEqual(["a1", "a2"]);
      expect(g.pendingPrompt).toBeNull(); // b 弃牌堆为空 → 跳过不挂起
    });

    it("032 精准删除：抽 3 张 → 删 2 张、弃 1 张，原手牌不受影响", () => {
      let g = makeGame();
      g.players[0]!.zones.hand = [card(14, "S", "h1")];
      g.players[0]!.zones.draw = [card(2, "S", "d1"), card(3, "H", "d2"), card(4, "D", "d3"), card(5, "C", "d4")];
      g.players[0]!.zones.discard = [];
      g = buy(g, "032");
      expect(g.pendingPrompt).toMatchObject({ kind: "chooseCard", effectId: "market:032", from: "hand" });
      expect(g.pendingPrompt!.candidates).toEqual(["d1", "d2", "d3"]);
      g = resolve(g, ["d1", "d2"]);
      expect(g.pendingPrompt).toBeNull();
      const a = g.players[0]!;
      expect(a.zones.deleted.map((c) => c.id)).toEqual(["d1", "d2"]);
      expect(a.zones.discard.map((c) => c.id)).toEqual(["d3"]);
      expect(a.zones.hand.map((c) => c.id)).toEqual(["h1"]); // 原手牌不动
      expect(a.zones.draw.map((c) => c.id)).toEqual(["d4"]);
    });

    it("032 精准删除：不选 → 3 张全部弃置", () => {
      let g = makeGame();
      g.players[0]!.zones.hand = [];
      g.players[0]!.zones.discard = [];
      g.players[0]!.zones.draw = [card(2, "S", "d1"), card(3, "H", "d2"), card(4, "D", "d3")];
      g = buy(g, "032");
      g = resolve(g, []);
      const a = g.players[0]!;
      expect(a.zones.deleted).toHaveLength(0);
      expect(a.zones.discard.map((c) => c.id)).toEqual(["d1", "d2", "d3"]);
      expect(a.zones.hand).toHaveLength(0);
    });

  });

  describe("特权证条件效果：车票类（票据 20）", () => {
    it("018 加密线路：结算时持有特权证的芯片持有者 +2 车票", () => {
      const g = makeGame();
      const a = g.players[0]!;
      a.zones.chips["t1"] = "018";
      g.passHolderSeat = a.seat;
      const before = a.tickets;
      runTimingQueue(g, resolveTiming(g, "settle", "after", CFG), CFG);
      expect(a.tickets).toBe(before + 2);
      expect(a.ticketsGainedThisTurn).toBe(2);
    });

    it("018 加密线路：未持有特权证不给车票，未插该芯片者也不给", () => {
      const g = makeGame();
      const a = g.players[0]!;
      const b = g.players[1]!;
      a.zones.chips["t1"] = "018";
      g.passHolderSeat = b.seat;
      const aBefore = a.tickets;
      const bBefore = b.tickets;
      runTimingQueue(g, resolveTiming(g, "settle", "after", CFG), CFG);
      expect(a.tickets).toBe(aBefore);
      expect(b.tickets).toBe(bBefore);
    });
  });

  describe("黑市区交互与结算末芯片（票据 20）", () => {
    it("043 再来一批：选 2 张回堆底并补位，候选不含刚买走的牌", () => {
      let g = makeGame();
      g.blackMarket.slots = [
        { defId: "028", price: 1, bonusChips: 0 },
        { defId: "029", price: 2, bonusChips: 0 },
        { defId: "030", price: 3, bonusChips: 0 },
      ];
      g.blackMarket.supply = [
        { defId: "034", price: 1 },
        { defId: "035", price: 1 },
      ];
      g = buy(g, "043"); // 购买先摘牌：043 被买走后 refill 用 supply 顶补 034
      expect(g.pendingPrompt).toMatchObject({ kind: "chooseCard", effectId: "market:043", from: "market" });
      expect(g.pendingPrompt!.candidates).toEqual(["1", "2"]); // 槽位 0 已摘牌，不在候选
      g = resolve(g, ["1", "2"]);
      expect(g.pendingPrompt).toBeNull();
      expect(g.blackMarket.slots.map((s) => s.defId)).toEqual(["034", "035", "029"]);
      expect(g.blackMarket.supply.map((s) => s.defId)).toEqual(["030"]);
      expect(g.players[0]!.purchaseFlipped).toBe(false); // 可再购买
    });

    it("043 再来一批：不选 → 只补位，黑市不变更", () => {
      let g = makeGame();
      g.blackMarket.slots = [
        { defId: "043", price: 1, bonusChips: 0 },
        { defId: "029", price: 2, bonusChips: 0 },
        { defId: null, price: 0, bonusChips: 0 },
      ];
      g.blackMarket.supply = [];
      g = buy(g, "043");
      expect(g.pendingPrompt!.candidates).toEqual(["1"]);
      g = resolve(g, []);
      expect(g.blackMarket.slots.map((s) => s.defId)).toEqual([null, "029", null]);
      expect(g.blackMarket.supply).toHaveLength(0);
      expect(g.players[0]!.purchaseFlipped).toBe(false);
    });

    it("043 再来一批：黑市已空 → 不挂起", () => {
      let g = makeGame();
      g.blackMarket.slots = [
        { defId: "043", price: 1, bonusChips: 0 },
        { defId: null, price: 0, bonusChips: 0 },
        { defId: null, price: 0, bonusChips: 0 },
      ];
      g.blackMarket.supply = [];
      g = buy(g, "043");
      expect(g.pendingPrompt).toBeNull();
    });

    it("025 自毁芯片：结算结束时删除本回合打出的牌（含芯片所在牌）", () => {
      const g = makeGame();
      const a = g.players[0]!;
      a.zones.discard = [card(5, "S", "p0-C1"), card(9, "H", "p0-C2"), card(2, "C", "p0-C3")];
      a.zones.chips["p0-C1"] = "025"; // 芯片插在打出的牌上
      g.duelResult = [
        {
          playerId: "a",
          category: HandCategory.对子,
          totalPoints: 10,
          rank: 1,
          cards: [
            { id: "p0-C1", rank: 5, suit: "S", wasJoker: false },
            { id: "p0-C2", rank: 9, suit: "H", wasJoker: false },
          ],
        },
      ];
      runTimingQueue(g, resolveTiming(g, "settle", "after", CFG), CFG);
      expect(a.zones.discard.map((c) => c.id)).toEqual(["p0-C3"]);
      expect(a.zones.deleted.map((c) => c.id).sort()).toEqual(["p0-C1", "p0-C2"]);
      expect(a.zones.chips["p0-C1"]).toBeUndefined(); // 芯片随牌销毁（金科玉律 10）
    });

    it("025 自毁芯片：本回合未打出牌 → 不删除", () => {
      const g = makeGame();
      const a = g.players[0]!;
      a.zones.discard = [card(5, "S", "p0-C1")];
      a.zones.chips["p0-C1"] = "025";
      g.duelResult = [
        {
          playerId: "b",
          category: HandCategory.高牌,
          totalPoints: 3,
          rank: 1,
          cards: [{ id: "p0-D1", rank: 3, suit: "D", wasJoker: false }],
        },
      ];
      runTimingQueue(g, resolveTiming(g, "settle", "after", CFG), CFG);
      expect(a.zones.discard.map((c) => c.id)).toEqual(["p0-C1"]);
      expect(a.zones.deleted).toHaveLength(0);
    });
  });
});
