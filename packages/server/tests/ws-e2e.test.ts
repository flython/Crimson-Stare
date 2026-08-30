/**
 * 票据 15 — server WS 契约集成测试（测试 seam ②：WebSocket 消息契约）。
 *
 * 用真实 ws 客户端双连接模拟 2 人简易局：
 * 1. 完整一回合（抽→换→出→决→结→购→删→整）端到端推进不卡死；
 * 2. 交互挂起：购买黄边强化芯片 → 收到 pendingPrompt → resolvePrompt → 断言芯片挂载；
 * 3. 超时托管：promptTimeoutSec=1 时挂起不 resolve → server 自动 autoResolve；
 * 4. 错误路径与身份重连。
 *
 * 状态链约定：所有 helper 以「最新快照」参数进入、返回「最新快照」，避免队列错位。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { loadGameConfig } from "../src/config.js";
import { loadCardPool } from "../src/cardPool.js";
import { RoomManager, type ServerMessage } from "../src/room.js";
import { SummaryStore } from "../src/db.js";

/** 仓库根 config 目录（vitest cwd 是 packages/server，手动上溯） */
const rootConfigDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config");

type Snap = Extract<ServerMessage, { type: "snapshot" }>;
type RoomMsg = Extract<ServerMessage, { type: "roomState" }>;

/** 测试侧快照类型（redactState 输出，裁剪后） */
interface SnapState {
  phase: string;
  turn: number;
  finished: boolean;
  winners: string[];
  players: Array<{
    id: string;
    name: string;
    seat: number;
    characterId: string | null;
    chips: number;
    tickets: number;
    phaseReady: boolean;
    zones: {
      hand: { count: number } | { cards: { id: string }[] };
      discard: { count: number } | { cards: { id: string }[] };
      play: { cards: unknown[] };
      chips: Record<string, string>;
    };
  }>;
  blackMarket: { slots: Array<{ defId: string | null; price: number; subtype?: string; bonusChips: number }>; supplyCount: number };
  pendingPrompt: {
    kind: string;
    playerId?: string;
    waitingFor?: string;
    candidates?: string[];
    from?: string;
  } | null;
  log: Array<{ turn: number; phase: string; text: string }>;
}

/** 测试客户端：连接 + 消息队列 + 按 type/pred 消费（所有服务端消息统一入队，避免时序丢失） */
class TestClient {
  ws: WebSocket;
  playerId: string;
  token: string;
  private queue: ServerMessage[] = [];
  private waiters: Array<{ type: string; pred?: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.playerId = "";
    this.token = "";
    ws.on("message", (data) => this.push(JSON.parse(data.toString()) as ServerMessage));
  }

  static async connect(url: string, name: string, token?: string): Promise<TestClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const client = new TestClient(ws); // 先注册消息监听，避免 welcome 连发的后续消息丢失
    ws.send(JSON.stringify({ type: "hello", name, token }));
    const welcome = (await client.recv("welcome")) as Extract<ServerMessage, { type: "welcome" }>;
    client.playerId = welcome.playerId;
    client.token = welcome.token;
    return client;
  }

  private push(msg: ServerMessage): void {
    this.queue.push(msg);
    this.flush();
  }

  private flush(): void {
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i]!;
      const idx = this.queue.findIndex((m) => m.type === w.type && (!w.pred || w.pred(m)));
      if (idx >= 0) {
        const msg = this.queue.splice(idx, 1)[0]!;
        this.waiters.splice(i, 1);
        w.resolve(msg);
      }
    }
  }

  /** 丢弃队列中已有消息（动作前清场，避免旧广播干扰） */
  drain(): void {
    this.queue.length = 0;
  }

  recv<T extends ServerMessage["type"]>(
    type: T,
    pred?: (m: Extract<ServerMessage, { type: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve) => {
      this.waiters.push({ type, pred: pred as (m: ServerMessage) => boolean, resolve: resolve as (m: ServerMessage) => void });
      this.flush();
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** 动作：清场 → 发送 → 等待动作后第一个 snapshot */
  async act(msg: unknown): Promise<Snap> {
    this.drain();
    this.send(msg);
    return this.recv("snapshot");
  }

  /** 等待某回合/阶段的最新快照（过滤中间杂讯） */
  waitPhase(phase: string, turn?: number): Promise<Snap> {
    return this.recv("snapshot", (m: Snap) => m.state.phase === phase && (turn === undefined || m.state.turn === turn));
  }

  close(): void {
    this.ws.close();
  }
}

let wss: WebSocketServer;
let manager: RoomManager;
let url: string;

beforeAll(async () => {
  const config = loadGameConfig(join(rootConfigDir, "game-config.json"));
  const pool = loadCardPool(rootConfigDir);
  manager = new RoomManager(config, pool);
  wss = new WebSocketServer({ port: 0 });
  wss.on("connection", (socket) => manager.attach(socket));
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const addr = wss.address() as { port: number };
  url = `ws://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  wss.close();
});

const clients: TestClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

function me(snap: Snap): SnapState["players"][number] {
  return (snap.state as SnapState).players.find((p) => p.id === snap.you)!;
}

/** 建房：2 人加入简易房间并开始，返回客户端与开局快照 */
async function setupGame(config?: Record<string, unknown>): Promise<{ a: TestClient; b: TestClient; room: RoomMsg; snapA: Snap; snapB: Snap }> {
  const a = await TestClient.connect(url, "阿A");
  const b = await TestClient.connect(url, "贝B");
  clients.push(a, b);
  a.send({ type: "createRoom", mode: "easy", ...(config ? { config } : {}) });
  const roomMsg = (await a.recv("roomState")) as RoomMsg;
  b.send({ type: "joinRoom", roomId: roomMsg.room.roomId });
  await b.recv("roomState");
  await a.recv("roomState");
  a.send({ type: "startGame" });
  await a.recv("roomState");
  await b.recv("roomState");
  const snapA = await a.waitPhase("swap");
  const snapB = await b.waitPhase("swap");
  return { a, b, room: roomMsg, snapA, snapB };
}

/** 换牌阶段：A 换 1 张后停止，B 停止 → 推进到出牌阶段（B 的 stopSwap 即触发进入 play） */
async function playSwap(a: TestClient, b: TestClient, snapA: Snap, snapB: Snap): Promise<{ snapA: Snap; snapB: Snap }> {
  const handA = (me(snapA).zones.hand as { cards: { id: string }[] }).cards;
  snapA = await a.act({ type: "action", action: { type: "swap", discardIds: [handA[0]!.id] } });
  snapA = await a.act({ type: "action", action: { type: "stopSwap" } });
  snapB = await b.act({ type: "action", action: { type: "stopSwap" } }); // B 停手 → 全 ready → play
  snapA = await a.waitPhase("play"); // A 收到进入 play 的广播
  return { snapA, snapB };
}

/** 出牌阶段：双方各出前 5 张 → 推进到购买阶段（B 的出牌即触发进入 purchase） */
async function playCardsPhase(a: TestClient, b: TestClient, snapA: Snap, snapB: Snap): Promise<{ snapA: Snap; snapB: Snap }> {
  const handA = (me(snapA).zones.hand as { cards: { id: string }[] }).cards;
  snapA = await a.act({ type: "action", action: { type: "playCards", cardIds: handA.slice(0, 5).map((c) => c.id) } });
  const handB = (me(snapB).zones.hand as { cards: { id: string }[] }).cards;
  snapB = await b.act({ type: "action", action: { type: "playCards", cardIds: handB.slice(0, 5).map((c) => c.id) } });
  snapA = await a.waitPhase("purchase"); // A 收到进入 purchase 的广播
  return { snapA, snapB };
}

/** 推进到购买阶段（换 + 出 完整动作链） */
async function toPurchase(a: TestClient, b: TestClient, snapA: Snap, snapB: Snap): Promise<{ snapA: Snap; snapB: Snap }> {
  const afterSwap = await playSwap(a, b, snapA, snapB);
  return playCardsPhase(a, b, afterSwap.snapA, afterSwap.snapB);
}

/** 购买强化芯片并完成一次 resolvePrompt；返回被挂载的芯片 defId、牌 id 与最新快照 */
async function buyChipAndResolve(
  a: TestClient,
  snapA: Snap,
): Promise<{ chipDef: string; cardId: string; snap: Snap; bought: boolean }> {
  let last = snapA;
  for (let guard = 0; guard < 40; guard++) {
    const state = last.state as SnapState;
    const my = state.players.find((p) => p.id === a.playerId)!;
    const slots = state.blackMarket.slots;
    // 优先买强化芯片（黄边需要选牌的牌）；否则买任意可买得起的牌触发 refill
    const chipIdx = slots.findIndex((s) => s.defId && s.subtype === "强化芯片" && s.price <= my.chips);
    const buyIdx = chipIdx >= 0 ? chipIdx : slots.findIndex((s) => s.defId && s.price <= my.chips);
    if (buyIdx < 0) {
      await a.act({ type: "action", action: { type: "skipPurchase" } });
      break;
    }
    const defId = slots[buyIdx]!.defId!;
    const isChip = slots[buyIdx]!.subtype === "强化芯片";
    last = await a.act({ type: "action", action: { type: "purchase", slotIndex: buyIdx } });
    const prompt = (last.state as SnapState).pendingPrompt;
    if (prompt && prompt.playerId === a.playerId && prompt.candidates && prompt.candidates.length > 0) {
      const choice = prompt.kind === "choosePlayer" ? prompt.candidates[0]! : [prompt.candidates[0]!];
      last = await a.act({ type: "resolvePrompt", choice });
    }
    if (isChip) {
      const mine = me(last);
      const cardId = Object.keys(mine.zones.chips).find((id) => mine.zones.chips[id] === defId);
      return { chipDef: defId, cardId: cardId ?? "", snap: last, bought: cardId !== undefined };
    }
    // 非芯片：refill 后的新槽已随本次 purchase 快照下发，直接进入下一轮找芯片
  }
  throw new Error("40 次购买内未买到强化芯片（黑市随机未出，测试失败）");
}

describe("WS 房间与协议（票据 15）", () => {
  it("2 人简易局完整一回合：抽→换→出→决→结→购→删→整，且交互挂起 resolve 芯片挂载", async () => {
    const { a, b, snapA, snapB } = await setupGame();

    // 抽(draw 自动) + 换(swap)：A 换 1 张再停，B 停
    const afterSwap = await playSwap(a, b, snapA, snapB);
    // 出(play) → 决(duel) → 结(settle) → 购(purchase)
    const afterPlay = await playCardsPhase(a, b, afterSwap.snapA, afterSwap.snapB);

    // 结：对决奖励入账（2 人局第一名 +4 票）
    const sumTickets = (afterPlay.snapA.state as SnapState).players.reduce((acc, p) => acc + p.tickets, 0);
    expect(sumTickets).toBeGreaterThanOrEqual(4);
    // 换牌停手后血筹充足（>= 4）
    const chipsAfterSwap = (afterPlay.snapA.state as SnapState).players.map((p) => p.chips);
    expect(Math.min(...chipsAfterSwap)).toBeGreaterThanOrEqual(4);

    // 购：买强化芯片 → pendingPrompt → resolve → 芯片挂载（交互覆盖）
    const bought = await buyChipAndResolve(a, afterPlay.snapA);
    expect(bought.chipDef.length).toBeGreaterThan(0);
    expect(bought.bought).toBe(true);
    const afterBuy = me(bought.snap);
    expect(afterBuy.zones.chips[bought.cardId]).toBe(bought.chipDef);
    // 购买挂起期间，对方视角 pendingPrompt 只见 waitingFor（redact 裁剪）
    const bSide = (await b.recv("snapshot")).state as SnapState;
    if (bSide.pendingPrompt) {
      expect(bSide.pendingPrompt.candidates).toBeUndefined();
      expect(bSide.pendingPrompt.waitingFor).toBe(a.playerId);
    }

    // 购：双方收尾（A 已买过，直接跳过；B 跳过）
    await a.act({ type: "action", action: { type: "skipPurchase" } });
    await b.act({ type: "action", action: { type: "skipPurchase" } });

    // 删(delete)：A 免费删 1 张 + ready，B ready
    const sDel = await a.waitPhase("delete");
    const discardA = (me(sDel).zones.discard as { cards: { id: string }[] }).cards;
    if (discardA.length > 0) {
      await a.act({ type: "action", action: { type: "deleteCards", cardIds: [discardA[0]!.id] } });
    }
    await a.act({ type: "action", action: { type: "ready" } });
    await b.act({ type: "action", action: { type: "ready" } });

    // 整(reshape)：双方不重洗 +2 血筹 → 下一回合
    const sReshape = await a.waitPhase("reshape");
    const beforeReshape = me(sReshape).chips;
    await a.act({ type: "action", action: { type: "reshape", reshuffle: false } });
    await b.act({ type: "action", action: { type: "reshape", reshuffle: false } }); // B 重整 → 结束回合进入下一回合

    // 断言：turn=2 进入下一回合（draw 自动进 swap），血筹 +2，日志完整
    const sNext = await a.waitPhase("swap", 2);
    const mine = me(sNext);
    expect(sNext.state.turn).toBe(2);
    expect(mine.chips).toBe(beforeReshape + 2);
    const log = (sNext.state as SnapState).log;
    expect(log.some((l) => l.text.includes("第 2 回合"))).toBe(true);
    expect(log.length).toBeGreaterThan(10);
    expect(sNext.state.finished).toBe(false);
  });

  it("超时托管：promptTimeoutSec=1 挂起不 resolve，server 自动 autoResolve 挂载芯片", async () => {
    const { a, b, snapA, snapB } = await setupGame({ promptTimeoutSec: 1 });
    const after = await toPurchase(a, b, snapA, snapB);

    // 买强化芯片 → 挂起，但不 resolve
    const state = after.snapA.state as SnapState;
    const slots = state.blackMarket.slots;
    const my = state.players.find((p) => p.id === a.playerId)!;
    const chipIdx = slots.findIndex((s) => s.defId && s.subtype === "强化芯片" && s.price <= my.chips);
    const defId = slots[chipIdx]!.defId!;
    const afterBuy = await a.act({ type: "action", action: { type: "purchase", slotIndex: chipIdx } });
    expect((afterBuy.state as SnapState).pendingPrompt?.playerId).toBe(a.playerId);

    // 等 server 超时自动 resolve（1s 超时 + 缓冲）；自动选择应挂载某芯片
    const resolved = await a.recv(
      "snapshot",
      (m: Snap) => (m.state as SnapState).pendingPrompt === null && Object.keys(me(m).zones.chips).length > 0,
    );
    const mine = me(resolved);
    expect(Object.values(mine.zones.chips)).toContain(defId);
  });

  it("错误路径：非房主不能开始 / 未 hello 不能建房", async () => {
    const a = await TestClient.connect(url, "房主");
    const b = await TestClient.connect(url, "路人");
    clients.push(a, b);
    a.send({ type: "createRoom", mode: "easy" });
    const roomMsg = (await a.recv("roomState")) as RoomMsg;
    b.send({ type: "joinRoom", roomId: roomMsg.room.roomId });
    await b.recv("roomState");

    // 非房主 startGame → NOT_OWNER
    b.send({ type: "startGame" });
    const err1 = (await b.recv("error")) as { code: string };
    expect(err1.code).toBe("NOT_OWNER");

    // 未 hello 的连接建房 → NEED_HELLO
    const raw = new WebSocket(url);
    await new Promise<void>((r) => raw.once("open", () => r()));
    raw.send(JSON.stringify({ type: "createRoom", mode: "easy" }));
    const err2 = await new Promise<ServerMessage>((resolve) => raw.once("message", (d) => resolve(JSON.parse(d.toString()))));
    expect(err2.type).toBe("error");
    expect((err2 as { code: string }).code).toBe("NEED_HELLO");
    raw.close();
  });

  it("断线重连：hello 携带 token 恢复身份与座位", async () => {
    const { a, b, snapA, snapB } = await setupGame();
    const token = a.token;
    const pid = a.playerId;
    a.close();
    // 新连接带 token 重连
    const a2 = await TestClient.connect(url, "阿A", token);
    clients.push(a2);
    expect(a2.playerId).toBe(pid);
    const roomState = (await a2.recv("roomState")) as RoomMsg;
    expect(roomState.room.started).toBe(true);
    // 补发快照，座位恢复在线可继续操作
    const snap = await a2.recv("snapshot");
    expect(snap.you).toBe(pid);
    const hand = (me(snap as Snap).zones.hand as { cards: { id: string }[] }).cards;
    await a2.act({ type: "action", action: { type: "swap", discardIds: [hand[0]!.id] } });
    await a2.act({ type: "action", action: { type: "stopSwap" } });
    await b.act({ type: "action", action: { type: "stopSwap" } });
    await a2.waitPhase("play");
    void snapB;
  });
});

describe("leaveRoom（票据 16）", () => {
  it("房主离开未开始房间：全体收到 leftRoom，房主可再建房", async () => {
    const a = await TestClient.connect(url, "房主");
    const b = await TestClient.connect(url, "成员");
    clients.push(a, b);
    a.send({ type: "createRoom", mode: "easy" });
    const roomMsg = (await a.recv("roomState")) as RoomMsg;
    b.send({ type: "joinRoom", roomId: roomMsg.room.roomId });
    await b.recv("roomState");
    await a.recv("roomState");

    a.send({ type: "leaveRoom" });
    const leftA = await a.recv("leftRoom");
    const leftB = await b.recv("leftRoom");
    expect(leftA.type).toBe("leftRoom");
    expect(leftB.type).toBe("leftRoom");

    // 房主可再建房
    a.send({ type: "createRoom", mode: "easy" });
    const room2 = (await a.recv("roomState")) as RoomMsg;
    expect(room2.room.roomId).toBeTruthy();
  });

  it("非房主离开未开始房间：房间保留，房主侧成员减少", async () => {
    const a = await TestClient.connect(url, "房主");
    const b = await TestClient.connect(url, "成员");
    clients.push(a, b);
    a.send({ type: "createRoom", mode: "easy" });
    const roomMsg = (await a.recv("roomState")) as RoomMsg;
    b.send({ type: "joinRoom", roomId: roomMsg.room.roomId });
    await b.recv("roomState");
    await a.recv("roomState");

    b.send({ type: "leaveRoom" });
    const leftB = await b.recv("leftRoom");
    expect(leftB.type).toBe("leftRoom");
    const roomAfter = (await a.recv("roomState")) as RoomMsg;
    expect(roomAfter.room.players.length).toBe(1);
  });
});

describe("票据 19：cardPool 元数据与 SQLite 局摘要", () => {
  it("hello 后下发 cardPool 元数据（含卡名/效果文本/图片路径）", async () => {
    const a = await TestClient.connect(url, "元数据");
    clients.push(a);
    const poolMsg = await a.recv("cardPool");
    expect(poolMsg.type).toBe("cardPool");
    expect(poolMsg.pool.version).toBeTruthy();
    expect(poolMsg.pool.roles.length).toBe(21);
    expect(poolMsg.pool.market.length).toBe(52);
    const chip = poolMsg.pool.market.find((m) => m.id === "001");
    expect(chip?.name).toBeTruthy();
    expect(chip?.effectText).toBeTruthy();
    expect(chip?.image).toMatch(/^assets\/cards\//);
    const role = poolMsg.pool.roles.find((r) => r.simpleOnly);
    expect(role?.effectText).toBeTruthy();
  });

  it("终局写 SQLite 局摘要（ticketGoals=4 首次结算即终局）", async () => {
    const dbPath = join(tmpdir(), "crimson-test-" + randomUUID() + ".db");
    const store = new SummaryStore(dbPath);
    const config = loadGameConfig(join(rootConfigDir, "game-config.json"));
    const mgr = new RoomManager(config, loadCardPool(rootConfigDir), { store });
    const local = new WebSocketServer({ port: 0 });
    local.on("connection", (socket) => mgr.attach(socket));
    await new Promise<void>((r) => local.once("listening", () => r()));
    const addr = local.address() as { port: number };
    const localUrl = "ws://127.0.0.1:" + addr.port;

    try {
      const a = await TestClient.connect(localUrl, "快局A");
      const b = await TestClient.connect(localUrl, "快局B");
      clients.push(a, b);
      a.send({ type: "createRoom", mode: "easy", config: { ticketGoals: { "2": 4, "3": 4, "4": 4 } } });
      const roomMsg = (await a.recv("roomState")) as RoomMsg;
      b.send({ type: "joinRoom", roomId: roomMsg.room.roomId });
      await b.recv("roomState");
      await a.recv("roomState");
      a.send({ type: "startGame" });
      await a.recv("roomState");
      const snapA = await a.waitPhase("swap");
      const snapB = await b.waitPhase("swap");

      // 换牌停手 → 各出 5 张 → 对决/结算自动推进，第一名 +4 票达标即终局
      // （目标 4 票时结算即结束，不会进入 purchase，故不 await waitPhase("purchase")）
      const afterSwap = await playSwap(a, b, snapA, snapB);
      const handA2 = (me(afterSwap.snapA).zones.hand as { cards: { id: string }[] }).cards;
      const handB2 = (me(afterSwap.snapB).zones.hand as { cards: { id: string }[] }).cards;
      await a.act({ type: "action", action: { type: "playCards", cardIds: handA2.slice(0, 5).map((c) => c.id) } });
      await b.act({ type: "action", action: { type: "playCards", cardIds: handB2.slice(0, 5).map((c) => c.id) } });
      const finA = await a.recv("snapshot", (m: Snap) => (m.state as SnapState).finished === true);
      expect(finA.state.finished).toBe(true);
      expect((finA.state as SnapState).winners.length).toBeGreaterThan(0);

      // 摘要已落库：一行记录，含双方终局数据与胜者（node:sqlite 运行时获取，见 src/db.ts 注释）
      const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as unknown as {
        DatabaseSync: new (path: string) => {
          exec(sql: string): void;
          prepare(sql: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown };
        };
      };
      const db = new DatabaseSync(dbPath);
      const row = db.prepare("SELECT * FROM game_records").get() as
        | { id: string; mode: string; player_count: number; winner: string; summary_json: string }
        | undefined;
      db.close();
      expect(row).toBeTruthy();
      expect(row!.mode).toBe("easy");
      expect(row!.player_count).toBe(2);
      expect(row!.winner.length).toBeGreaterThan(0);
      const summary = JSON.parse(row!.summary_json) as { turn: number; winners: string[]; players: unknown[] };
      expect(summary.players.length).toBe(2);
      expect(summary.winners.length).toBeGreaterThan(0);
      expect(summary.turn).toBeGreaterThanOrEqual(1);
    } finally {
      local.close();
    }
  });
});
