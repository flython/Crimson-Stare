/**
 * 交互机制单测（M2.4，票据 13）。
 * 覆盖：挂起与恢复 / 挂起门禁 / 等待者校验 / 非法选择拒绝 / 超时托管 autoResolve / redact 可见性裁剪。
 */
import { describe, it, expect } from "vitest";
import { createGame, reduce, type Action } from "../src/game/whiteboard.js";
import { DEFAULT_GAME_CONFIG } from "../src/core/config.js";
import { registerEffect, getEffect } from "../src/core/effects.js";
import { redactState } from "../src/core/redact.js";
import { promptChooseCard, autoResolve } from "../src/effects/interactive.js";
import { spendChips, deleteFromDiscard } from "../src/effects/primitives.js";

/** 测试用交互效果：选择一位对手，扣自己 2 血筹给对手 */
registerEffect({
  id: "test:steal",
  source: "blackMarket",
  phase: "purchase",
  timing: "during",
  run: (state, ctx) => {
    const candidates = state.players.filter((p) => p.id !== ctx.playerId).map((p) => p.id);
    state.pendingPrompt = {
      kind: "choosePlayer",
      effectId: "test:steal",
      playerId: ctx.playerId,
      candidates,
      promptText: "选择一位对手",
    };
  },
  resolve: (state, ctx, choice) => {
    spendChips(2)(state, ctx);
    const target = state.players.find((p) => p.id === choice)!;
    target.chips += 2;
  },
});

/** 测试用交互效果：从弃牌区选至多 2 张删除 */
registerEffect({
  id: "test:discard-delete",
  source: "blackMarket",
  phase: "purchase",
  timing: "during",
  run: (state, ctx) => {
    const ids = state.players.find((p) => p.id === ctx.playerId)!.zones.discard.slice(0, 2).map((c) => c.id);
    promptChooseCard(state, "test:discard-delete", ctx.playerId, ids, "discard", "选牌删除");
  },
  resolve: (state, ctx, choice) => {
    for (const id of choice as string[]) deleteFromDiscard(id)(state, ctx);
  },
});

function makeGame() {
  const state = createGame(
    [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    DEFAULT_GAME_CONFIG,
    12345,
  );
  return state;
}

function act(state: ReturnType<typeof createGame>, action: Action): ReturnType<typeof createGame> {
  return reduce(state, action, DEFAULT_GAME_CONFIG);
}

/** 手工触发一个效果的 run（模拟时间点队列执行后的挂起） */
function triggerRun(state: ReturnType<typeof createGame>, defId: string, playerId: string): void {
  const def = getEffect(defId)!;
  def.run(state, { config: DEFAULT_GAME_CONFIG, playerId, effectId: defId });
}

describe("交互机制（M2.4）", () => {
  it("choosePlayer 挂起与恢复：resolvePrompt 后效果继续并清空挂起", () => {
    const state = makeGame();
    const a = state.players.find((p) => p.id === "a")!;
    const b = state.players.find((p) => p.id === "b")!;
    a.chips = 5;
    b.chips = 1;

    triggerRun(state, "test:steal", "a");
    expect(state.pendingPrompt).toMatchObject({ kind: "choosePlayer", effectId: "test:steal", playerId: "a" });

    const next = act(state, { type: "resolvePrompt", playerId: "a", choice: "b" });
    expect(next.pendingPrompt).toBeNull();
    expect(next.players.find((p) => p.id === "a")!.chips).toBe(3); // -2
    expect(next.players.find((p) => p.id === "b")!.chips).toBe(3); // +2
  });

  it("chooseCard 挂起与恢复：多选牌删除", () => {
    const state = makeGame();
    const a = state.players.find((p) => p.id === "a")!;
    // 弃牌区造 2 张牌（覆盖开局比点数的那 1 张）
    a.zones.discard = [
      { rank: 5, suit: "H", isJoker: false, id: "x1" },
      { rank: 9, suit: "S", isJoker: false, id: "x2" },
    ];
    triggerRun(state, "test:discard-delete", "a");
    expect(state.pendingPrompt).toMatchObject({ kind: "chooseCard", from: "discard" });

    const next = act(state, { type: "resolvePrompt", playerId: "a", choice: ["x1", "x2"] });
    expect(next.pendingPrompt).toBeNull();
    expect(next.players.find((p) => p.id === "a")!.zones.deleted.some((c) => c.id === "x1")).toBe(true);
    expect(next.players.find((p) => p.id === "a")!.zones.discard.some((c) => c.id === "x2")).toBe(false);
  });

  it("挂起门禁：pendingPrompt 非空时其他 Action 被拒", () => {
    const state = makeGame();
    triggerRun(state, "test:steal", "a");
    expect(() => act(state, { type: "stopSwap", playerId: "a" })).toThrow(/有待决交互/);
  });

  it("等待者校验：非目标玩家的 resolvePrompt 被拒", () => {
    const state = makeGame();
    triggerRun(state, "test:steal", "a");
    expect(() => act(state, { type: "resolvePrompt", playerId: "b", choice: "a" })).toThrow(/等待其他玩家选择/);
  });

  it("非法选择：不在候选内被拒", () => {
    const state = makeGame();
    triggerRun(state, "test:steal", "a");
    expect(() => act(state, { type: "resolvePrompt", playerId: "a", choice: "nobody" })).toThrow(/非法选择/);
  });

  it("chooseCard 重复选择被拒", () => {
    const state = makeGame();
    const a = state.players.find((p) => p.id === "a")!;
    a.zones.discard = [{ rank: 5, suit: "H", isJoker: false, id: "x1" }];
    triggerRun(state, "test:discard-delete", "a");
    expect(() => act(state, { type: "resolvePrompt", playerId: "a", choice: ["x1", "x1"] })).toThrow(/重复/);
  });

  it("autoResolve：choosePlayer 随机返回候选之一，chooseCard 默认不选", () => {
    const state = makeGame();
    triggerRun(state, "test:steal", "a");
    const choice = autoResolve(state);
    expect(["a", "b"]).toContain(choice);

    const state2 = makeGame();
    const a2 = state2.players.find((p) => p.id === "a")!;
    a2.zones.discard.push({ rank: 5, suit: "H", isJoker: false, id: "x1" });
    triggerRun(state2, "test:discard-delete", "a");
    expect(autoResolve(state2)).toEqual([]);
  });

  it("redact：目标玩家见完整候选，其他玩家只见 waitingFor", () => {
    const state = makeGame();
    triggerRun(state, "test:steal", "a");
    const viewA = redactState(state, "a") as { pendingPrompt: object };
    const viewB = redactState(state, "b") as { pendingPrompt: object };
    expect(viewA.pendingPrompt).toMatchObject({ kind: "choosePlayer", candidates: ["b"] });
    expect(viewB.pendingPrompt).toMatchObject({ waitingFor: "a" });
    expect((viewB.pendingPrompt as { candidates?: unknown }).candidates).toBeUndefined();
  });

  it("无挂起时 resolvePrompt 被拒", () => {
    const state = makeGame();
    expect(() => act(state, { type: "resolvePrompt", playerId: "a", choice: "b" })).toThrow(/当前没有待决交互/);
  });
});
