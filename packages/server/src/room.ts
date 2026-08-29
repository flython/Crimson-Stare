/**
 * 票据 15 — 房间模型与 WS 协议处理。
 *
 * 设计（对齐 docs/protocol.md，04 票据契约）：
 * - 房间只存内存（Map），服务端是引擎 state 唯一权威持有者；
 * - 客户端只发意图（Action / resolvePrompt），playerId 由 server 从连接身份推断；
 * - 每次状态变更后对每个连接调用 redactState(state, viewerId) 裁剪，广播全量快照；
 *   日志随 snapshot.state.log 全量下发（不单独发 log 增量消息，避免 diff 复杂度）。
 * - 简易模式建房：createGame 注入 pool + { simple: true }，4 张 simpleOnly 角色开局随机分配；
 * - resolvePrompt：客户端发 { type:"resolvePrompt", choice }，server 映射为引擎 resolvePrompt Action；
 * - 超时托管：pendingPrompt 挂起超过 config.promptTimeoutSec 后调 engine autoResolve 取默认选择自动 resolve
 *   （timeoutPolicy="strict" 不托管）；连接断开且正被等待选择时立即托管。
 * - 阶段级掉线托管（最小版）：离线玩家未 ready 超过 autoPassTimeoutSec 后提交该阶段默认 Action。
 * - 终局：state.finished 后广播终局快照，房间保留供查看；SQLite 局摘要为遗留（见票据 Answer）。
 *
 * 遗留标注：
 * - SQLite 局摘要未写（优先跑通 WS 链路，协议 v1 已约定"仅终局写一条"）。
 * - updateConfig 消息未实现（MVP 建房时一次性定配置）。
 * - play 阶段掉线托管的最优出牌用枚举 5 张子集近似（evaluateHand + compareHands）。
 * - engine autoResolve 对 chooseCard 返回 []（"不选"），数值类强化芯片 resolve 会抛错
 *   （找不到牌 undefined），server 兜底改选首个候选避免挂起卡死。
 */
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  createGame,
  reduce,
  redactState,
  autoResolve,
  evaluateHand,
  compareHands,
  type Action,
  type GameConfig,
  type GameState,
  type CardPool,
  type PlayerState,
  type HandEvaluation,
} from "@crimson/engine";

export type Mode = "easy" | "standard";

/** 客户端 → 服务端消息（docs/protocol.md v1 对齐；action 内 playerId 由 server 注入） */
export type ClientMessage =
  | { type: "hello"; name: string; token?: string }
  | { type: "createRoom"; mode?: Mode; config?: Partial<GameConfig> }
  | { type: "joinRoom"; roomId: string }
  | { type: "startGame" }
  | { type: "action"; action: Omit<Action, "playerId"> }
  | { type: "resolvePrompt"; choice: string | string[] }
  | { type: "reconnect"; token: string }
  | { type: "leaveRoom" };

/** 服务端 → 客户端消息 */
export type ServerMessage =
  | { type: "welcome"; playerId: string; token: string }
  | { type: "roomState"; room: RoomView }
  | { type: "snapshot"; state: object; you: string }
  | { type: "leftRoom"; reason: "ownerLeft" | "left" | "roomClosed" }
  | { type: "error"; code: string; message: string };

/** 大厅视角的房间（web lobby 渲染） */
export interface RoomView {
  roomId: string;
  mode: Mode;
  started: boolean;
  finished: boolean;
  ownerId: string;
  players: { playerId: string; name: string; seat: number; connected: boolean; characterId: string | null }[];
}

interface Seat {
  playerId: string;
  name: string;
  characterId: string | null;
  socket: WebSocket | null;
  connected: boolean;
}

interface Identity {
  playerId: string;
  name: string;
  token: string;
}

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

function randomId(prefix: string): string {
  return `${prefix}${randomUUID().slice(0, 8)}`;
}

/** 原地 Fisher–Yates 洗牌（角色随机分配 / 无关引擎 rng） */
function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

/** 阶段级掉线托管：离线玩家在该阶段的默认 Action（最小操作原则） */
function autoActionFor(state: GameState, p: PlayerState): Action | null {
  switch (state.phase) {
    case "swap":
      return { type: "stopSwap", playerId: p.id }; // 不换牌，剩余次数换血筹
    case "play": {
      const ids = bestPlayCards(p);
      if (ids.length === 0) return null; // 手牌已空（打空的现实边界），标注遗留
      return { type: "playCards", playerId: p.id, cardIds: ids };
    }
    case "purchase":
      return { type: "skipPurchase", playerId: p.id };
    case "delete":
      return { type: "ready", playerId: p.id }; // 不删牌
    case "reshape":
      return { type: "reshape", playerId: p.id, reshuffle: false }; // 取 2 血筹
    default:
      return null; // draw/duel/settle 无玩家交互，自动推进
  }
}

/** 托管出牌：手牌 ≤5 全出；否则枚举 5 张子集取最优牌型（同型比总点数） */
function bestPlayCards(p: PlayerState): string[] {
  const hand = p.zones.hand;
  if (hand.length <= 5) return hand.map((c) => c.id);
  let best: string[] = [];
  let bestEv: HandEvaluation | null = null;
  for (let skip = 0; skip < hand.length; skip++) {
    const cards = hand.filter((_, i) => i !== skip);
    const ev = evaluateHand(cards);
    if (!bestEv || compareHands(ev, bestEv) > 0) {
      bestEv = ev;
      best = cards.map((c) => c.id);
    }
  }
  return best;
}

export class Room {
  readonly id: string;
  readonly mode: Mode;
  readonly ownerId: string;
  readonly config: GameConfig;
  private readonly pool: CardPool;
  readonly seats: Seat[] = [];
  state: GameState | null = null;
  started = false;
  finished = false;
  private promptTimer: NodeJS.Timeout | null = null;
  private phaseTimer: NodeJS.Timeout | null = null;

  constructor(opts: { id: string; mode: Mode; ownerId: string; config: GameConfig; pool: CardPool }) {
    this.id = opts.id;
    this.mode = opts.mode;
    this.ownerId = opts.ownerId;
    this.config = opts.config;
    this.pool = opts.pool;
  }

  view(): RoomView {
    return {
      roomId: this.id,
      mode: this.mode,
      started: this.started,
      finished: this.finished,
      ownerId: this.ownerId,
      players: this.seats.map((s) => ({
        playerId: s.playerId,
        name: s.name,
        seat: this.seats.indexOf(s),
        connected: s.connected,
        characterId: s.characterId,
      })),
    };
  }

  seatOf(playerId: string): Seat | undefined {
    return this.seats.find((s) => s.playerId === playerId);
  }

  addSeat(identity: Identity, socket: WebSocket): void {
    this.seats.push({ playerId: identity.playerId, name: identity.name, characterId: null, socket, connected: true });
  }

  /** 连接断开：保留座位（身份可重连恢复），标记离线 */
  detach(playerId: string): void {
    const seat = this.seatOf(playerId);
    if (seat) {
      seat.socket = null;
      seat.connected = false;
    }
  }

  /** 移除座位（未开始房间的离开）；返回移除后房间是否已空 */
  removeSeat(playerId: string): boolean {
    const idx = this.seats.findIndex((s) => s.playerId === playerId);
    if (idx !== -1) this.seats.splice(idx, 1);
    return this.seats.length === 0;
  }

  /** 关闭房间（解散时调用）：清定时器并广播解散通知 */
  close(reason: "ownerLeft" | "roomClosed"): void {
    this.clearTimers();
    for (const seat of this.seats) {
      if (seat.socket) send(seat.socket, { type: "leftRoom", reason });
    }
  }

  /** 重连：恢复座位连接（offline → online） */
  rebind(playerId: string, socket: WebSocket): void {
    const seat = this.seatOf(playerId);
    if (!seat) return;
    seat.socket = socket;
    seat.connected = true;
  }

  /** 开始对局：简易模式随机分配 4 张 simpleOnly 角色 → createGame 注入 pool + simple 过滤 */
  start(): void {
    if (this.state || this.started) return;
    if (this.seats.length < MIN_PLAYERS) throw new Error(`至少需要 ${MIN_PLAYERS} 名玩家`);
    if (this.mode === "easy") {
      const roleIds = shuffleArray(this.pool.roles.filter((r) => r.simpleOnly).map((r) => r.id));
      this.seats.forEach((s, i) => {
        s.characterId = roleIds[i % roleIds.length] ?? null;
      });
    }
    const seed = Math.floor(Math.random() * 0xffffffff);
    this.state = createGame(
      this.seats.map((s) => ({ id: s.playerId, name: s.name, characterId: s.characterId ?? undefined })),
      this.config,
      seed,
      this.pool,
      { simple: this.mode === "easy" },
    );
    this.started = true;
  }

  /**
   * 提交引擎 Action（playerId 由 server 注入）。成功 → 广播裁剪快照 + 托管定时器重排；
   * 失败 → 向 caller 发 error（state 不变）。
   */
  applyAction(action: Action, caller: WebSocket | null): boolean {
    if (!this.state) throw new Error("游戏未开始");
    try {
      this.state = reduce(this.state, action, this.config);
    } catch (err) {
      if (caller) send(caller, { type: "error", code: "BAD_ACTION", message: (err as Error).message });
      return false;
    }
    this.afterStateChange();
    return true;
  }

  afterStateChange(): void {
    this.broadcastState();
    this.armTimers();
    if (this.state?.finished) {
      this.finished = true;
      this.clearTimers();
    }
  }

  broadcastRoomState(): void {
    const msg: ServerMessage = { type: "roomState", room: this.view() };
    for (const s of this.seats) if (s.socket) send(s.socket, msg);
  }

  /** 按连接逐个 redactState 裁剪后下发全量快照（可见性执行点 = 分发层） */
  broadcastState(): void {
    if (!this.state) return;
    for (const s of this.seats) {
      if (!s.socket) continue;
      send(s.socket, { type: "snapshot", state: redactState(this.state, s.playerId), you: s.playerId });
    }
  }

  /** 单独向某座位补发当前快照（重连恢复用） */
  sendStateTo(playerId: string): void {
    const seat = this.seatOf(playerId);
    if (seat?.socket && this.state) {
      send(seat.socket, { type: "snapshot", state: redactState(this.state, playerId), you: playerId });
    }
  }

  // ── 超时托管 ──────────────────────────────────────────────

  private clearTimers(): void {
    if (this.promptTimer) {
      clearTimeout(this.promptTimer);
      this.promptTimer = null;
    }
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }

  /** 托管定时器重排（连接断开/状态变更后由 manager 与 afterStateChange 调用） */
  armTimers(): void {
    this.clearTimers();
    if (!this.state || this.state.finished) return;

    // 1) 交互挂起超时：autoResolve 取默认选择（timeoutPolicy="auto"）
    if (this.state.pendingPrompt && this.config.timeoutPolicy === "auto") {
      this.promptTimer = setTimeout(() => this.autoPromptResolve(), this.config.promptTimeoutSec * 1000);
      return;
    }
    // 2) 阶段级掉线托管：存在离线且未 ready 的玩家 → autoPassTimeoutSec 后自动走默认 Action
    const offline = this.state.players.find((p) => {
      const seat = this.seatOf(p.id);
      return seat && !seat.connected && !p.phaseReady;
    });
    if (offline) {
      this.phaseTimer = setTimeout(() => this.autoPhaseAdvance(), this.config.autoPassTimeoutSec * 1000);
    }
  }

  /** 交互挂起超时托管（manager 在连接断开时也直接调用以立即托管） */
  autoPromptResolve(): void {
    if (!this.state?.pendingPrompt) return;
    const target = this.state.pendingPrompt.playerId;
    let choice = autoResolve(this.state);
    // engine autoResolve 对 chooseCard 返回 []（"不选"），数值类芯片 resolve 会抛错卡死挂起；
    // server 兜底改选首个候选（有意义的默认选择）。
    if (
      Array.isArray(choice) &&
      choice.length === 0 &&
      this.state.pendingPrompt.kind === "chooseCard" &&
      this.state.pendingPrompt.candidates.length > 0
    ) {
      choice = [this.state.pendingPrompt.candidates[0]!];
    }
    this.applyAction({ type: "resolvePrompt", playerId: target, choice }, null);
  }

  private autoPhaseAdvance(): void {
    if (!this.state || this.state.finished) return;
    const target = this.state.players.find((p) => {
      const seat = this.seatOf(p.id);
      return seat && !seat.connected && !p.phaseReady;
    });
    if (!target) return;
    const action = autoActionFor(this.state, target);
    if (action) this.applyAction(action, null);
    // 动作后状态可能仍在等待同玩家（如 play 手牌空）→ 下一轮 timer 由 afterStateChange 重排
  }
}

export class RoomManager {
  private readonly baseConfig: GameConfig;
  private readonly pool: CardPool;
  private readonly rooms = new Map<string, Room>();
  /** token → 身份（本地持久化后可恢复座位） */
  private readonly identities = new Map<string, Identity>();
  /** 连接 → 身份（hello 后填充） */
  private readonly socketIdentity = new Map<WebSocket, Identity>();
  /** playerId → 所在房间 id */
  private readonly playerRooms = new Map<string, string>();

  constructor(config: GameConfig, pool: CardPool) {
    this.baseConfig = config;
    this.pool = pool;
  }

  roomOf(identity: Identity): Room | null {
    const roomId = this.playerRooms.get(identity.playerId);
    return roomId ? this.rooms.get(roomId) ?? null : null;
  }

  /** 绑定一个新 WebSocket 连接（WebSocketServer connection 事件） */
  attach(socket: WebSocket): void {
    socket.on("message", (data) => this.handleMessage(socket, data.toString()));
    socket.on("close", () => this.handleClose(socket));
    socket.on("error", () => undefined);
  }

  private handleMessage(socket: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      send(socket, { type: "error", code: "BAD_JSON", message: "消息不是合法 JSON" });
      return;
    }
    try {
      switch (msg.type) {
        case "hello":
          this.handleHello(socket, msg);
          return;
        case "reconnect":
          this.handleReconnect(socket, msg.token);
          return;
        case "createRoom":
          this.handleCreateRoom(socket, msg);
          return;
        case "joinRoom":
          this.handleJoinRoom(socket, msg.roomId);
          return;
        case "startGame":
          this.handleStartGame(socket);
          return;
        case "action":
          this.handleAction(socket, msg.action);
          return;
        case "resolvePrompt":
          this.handleResolvePrompt(socket, msg.choice);
          return;
        case "leaveRoom":
          this.handleLeaveRoom(socket);
          return;
        default: {
          const exhaustive: never = msg;
          send(socket, { type: "error", code: "UNKNOWN_TYPE", message: `未知消息类型: ${JSON.stringify(exhaustive)}` });
        }
      }
    } catch (err) {
      send(socket, { type: "error", code: "INTERNAL", message: (err as Error).message });
    }
  }

  private requireIdentity(socket: WebSocket): Identity {
    const identity = this.socketIdentity.get(socket);
    if (!identity) {
      send(socket, { type: "error", code: "NEED_HELLO", message: "连接后请先发送 hello" });
      throw new Error("未先 hello");
    }
    return identity;
  }

  private handleHello(socket: WebSocket, msg: { name: string; token?: string }): void {
    let identity = msg.token ? this.identities.get(msg.token) : undefined;
    if (!identity) {
      identity = { playerId: randomId("p"), name: msg.name.trim() || "玩家", token: randomId("t") + randomId("") };
      this.identities.set(identity.token, identity);
    } else if (msg.name.trim()) {
      identity.name = msg.name.trim();
    }
    this.socketIdentity.set(socket, identity);
    send(socket, { type: "welcome", playerId: identity.playerId, token: identity.token });

    // 若身份已在房间（断线重连）→ 恢复座位并补发状态
    const room = this.roomOf(identity);
    if (room) {
      room.rebind(identity.playerId, socket);
      send(socket, { type: "roomState", room: room.view() });
      if (room.state) room.sendStateTo(identity.playerId);
    }
  }

  private handleReconnect(socket: WebSocket, token: string): void {
    this.handleHello(socket, { name: "", token });
  }

  private handleCreateRoom(socket: WebSocket, msg: { mode?: Mode; config?: Partial<GameConfig> }): void {
    const identity = this.requireIdentity(socket);
    const mode = msg.mode ?? "easy";
    if (mode !== "easy") {
      send(socket, { type: "error", code: "MODE_UNAVAILABLE", message: "标准/单人模式尚未开放，请选择简易模式" });
      return;
    }
    if (this.roomOf(identity)) {
      send(socket, { type: "error", code: "ALREADY_IN_ROOM", message: "你已在房间中" });
      return;
    }
    const room = new Room({
      id: randomId("r"),
      mode,
      ownerId: identity.playerId,
      config: { ...this.baseConfig, ...(msg.config ?? {}) },
      pool: this.pool,
    });
    this.rooms.set(room.id, room);
    room.addSeat(identity, socket);
    this.playerRooms.set(identity.playerId, room.id);
    room.broadcastRoomState();
  }

  private handleJoinRoom(socket: WebSocket, roomId: string): void {
    const identity = this.requireIdentity(socket);
    const room = this.rooms.get(roomId);
    if (!room) {
      send(socket, { type: "error", code: "ROOM_NOT_FOUND", message: `房间不存在: ${roomId}` });
      return;
    }
    if (this.roomOf(identity)) {
      send(socket, { type: "error", code: "ALREADY_IN_ROOM", message: "你已在房间中" });
      return;
    }
    if (room.started) {
      send(socket, { type: "error", code: "ALREADY_STARTED", message: "对局已开始，无法加入" });
      return;
    }
    if (room.seats.length >= MAX_PLAYERS) {
      send(socket, { type: "error", code: "ROOM_FULL", message: "房间已满" });
      return;
    }
    room.addSeat(identity, socket);
    this.playerRooms.set(identity.playerId, room.id);
    room.broadcastRoomState();
  }

  /**
   * 离开房间（票据 16）：
   * - 对局已开始 → 等同断开（座位保留 + 托管继续，可重连恢复）
   * - 未开始且房主离开 → 解散房间（通知全体 leftRoom）
   * - 未开始且非房主离开 → 移出座位，广播成员更新
   */
  private handleLeaveRoom(socket: WebSocket): void {
    const identity = this.requireIdentity(socket);
    const room = this.roomOf(identity);
    if (!room) {
      send(socket, { type: "error", code: "NOT_IN_ROOM", message: "你不在任何房间中" });
      return;
    }
    if (room.started) {
      room.detach(identity.playerId);
      room.broadcastRoomState();
      return;
    }
    const wasOwner = room.ownerId === identity.playerId;
    const empty = room.removeSeat(identity.playerId);
    this.playerRooms.delete(identity.playerId);
    if (wasOwner) {
      this.rooms.delete(room.id);
      room.close("ownerLeft");
      send(socket, { type: "leftRoom", reason: "ownerLeft" });
    } else if (empty) {
      this.rooms.delete(room.id);
      room.close("roomClosed");
      send(socket, { type: "leftRoom", reason: "left" });
    } else {
      send(socket, { type: "leftRoom", reason: "left" });
      room.broadcastRoomState();
    }
  }

  private handleStartGame(socket: WebSocket): void {
    const identity = this.requireIdentity(socket);
    const room = this.roomOf(identity);
    if (!room) {
      send(socket, { type: "error", code: "NOT_IN_ROOM", message: "你不在任何房间中" });
      return;
    }
    if (room.ownerId !== identity.playerId) {
      send(socket, { type: "error", code: "NOT_OWNER", message: "只有房主可以开始游戏" });
      return;
    }
    if (room.started) {
      send(socket, { type: "error", code: "ALREADY_STARTED", message: "对局已开始" });
      return;
    }
    room.start();
    room.broadcastRoomState();
    room.afterStateChange();
  }

  private handleAction(socket: WebSocket, action: Omit<Action, "playerId">): void {
    const identity = this.requireIdentity(socket);
    const room = this.roomOf(identity);
    if (!room) {
      send(socket, { type: "error", code: "NOT_IN_ROOM", message: "你不在任何房间中" });
      return;
    }
    if (!room.state) {
      send(socket, { type: "error", code: "GAME_NOT_STARTED", message: "对局尚未开始" });
      return;
    }
    room.applyAction({ ...action, playerId: identity.playerId } as Action, socket);
  }

  private handleResolvePrompt(socket: WebSocket, choice: string | string[]): void {
    const identity = this.requireIdentity(socket);
    const room = this.roomOf(identity);
    if (!room) {
      send(socket, { type: "error", code: "NOT_IN_ROOM", message: "你不在任何房间中" });
      return;
    }
    const prompt = room.state?.pendingPrompt;
    if (!prompt) {
      send(socket, { type: "error", code: "NO_PROMPT", message: "当前没有待决交互" });
      return;
    }
    if (prompt.playerId !== identity.playerId) {
      send(socket, { type: "error", code: "NOT_YOUR_TURN", message: "等待其他玩家选择" });
      return;
    }
    room.applyAction({ type: "resolvePrompt", playerId: identity.playerId, choice }, socket);
  }

  private handleClose(socket: WebSocket): void {
    const identity = this.socketIdentity.get(socket);
    this.socketIdentity.delete(socket);
    if (!identity) return;
    const room = this.roomOf(identity);
    if (!room) return;
    room.detach(identity.playerId);
    // 正在被等待选择 → 立即托管，避免挂起卡死整局
    if (room.state?.pendingPrompt && room.state.pendingPrompt.playerId === identity.playerId) {
      room.autoPromptResolve();
    } else {
      room.armTimers(); // 阶段级掉线托管（离线超时）
    }
  }
}
