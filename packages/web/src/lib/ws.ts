/**
 * 票据 15 — WebSocket 客户端封装（对齐 docs/protocol.md v1）。
 *
 * 连接 → hello（带 localStorage 持久化 token 可恢复身份）→ welcome 后进入 lobby；
 * 服务端消息统一回调 onMessage；发送层封装 send()。
 */
import type { Card, CardPool } from "@crimson/engine";

export interface RoomView {
  roomId: string;
  mode: "easy" | "standard" | "solo";
  started: boolean;
  finished: boolean;
  ownerId: string;
  players: Array<{ playerId: string; name: string; seat: number; connected: boolean; characterId: string | null }>;
}

/** 服务端 → 客户端消息（protocol.md；snapshot.state 为 redactState 输出，见 SnapState） */
export type ServerMessage =
  | { type: "welcome"; playerId: string; token: string }
  | { type: "cardPool"; pool: CardPool }
  | { type: "roomState"; room: RoomView }
  | { type: "snapshot"; state: SnapState; you: string }
  | { type: "leftRoom"; reason: "ownerLeft" | "left" | "roomClosed" }
  | { type: "error"; code: string; message: string };

/** 裁剪后快照（redactState 输出，web 渲染数据源） */
export interface SnapState {
  phase: string;
  turn: number;
  passHolderSeat: number | null;
  players: Array<{
    id: string;
    name: string;
    seat: number;
    characterId: string | null;
    chips: number;
    tickets: number;
    swapLeft: number;
    purchaseFlipped: boolean;
    phaseReady: boolean;
    zones: {
      draw: { count: number };
      hand: { count: number } | { cards: Card[] };
      discard: { count: number } | { cards: Card[] };
      play: { count: number } | { cards: Card[] }; // 暗扣：出牌阶段他人只见 count，对决亮牌后为 cards（票据 24）
      deleted: { count: number } | { cards: Card[] };
      chips: Record<string, string>;
      items: string[];
    };
  }>;
  blackMarket: {
    slots: Array<{ defId: string | null; price: number; bonusChips: number; subtype?: string }>;
    supplyCount: number;
  };
  pendingPrompt: unknown | null;
  log: Array<{ turn: number; phase: string; text: string }>;
  finished: boolean;
  winners: string[];
  /** 本回合对决结果（结算阶段写入，展示各玩家牌型/名次/奖励） */
  duelResult?: Array<{
    playerId: string;
    category: number;
    totalPoints: number;
    rank: number;
    cards: Array<{ id: string; rank: number; suit: string; wasJoker: boolean }>;
  }>;
}

export interface GameClientOptions {
  url: string;
  name: string;
  token?: string;
  onMessage: (msg: ServerMessage) => void;
  onClose?: () => void;
}

/** 默认 WS 地址：与 dev server 同主机的 8080 端口，可用 VITE_WS_URL 覆盖 */
export function defaultWsUrl(): string {
  return import.meta.env.VITE_WS_URL ?? `ws://${location.hostname}:8080`;
}

export class GameClient {
  playerId = "";
  token = "";
  private ws: WebSocket | null = null;
  private readonly opts: GameClientOptions;

  constructor(opts: GameClientOptions) {
    this.opts = opts;
  }

  /** 连接并完成 hello/welcome 握手 */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "hello", name: this.opts.name, token: this.opts.token }));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        if (msg.type === "welcome") {
          this.playerId = msg.playerId;
          this.token = msg.token;
          resolve();
        }
        if (msg.type === "error") {
          // 握手期错误也会 reject（连接失败）
          reject(new Error(msg.message));
          return;
        }
        this.opts.onMessage(msg);
      };
      ws.onerror = () => reject(new Error("无法连接服务器"));
      ws.onclose = () => this.opts.onClose?.();
    });
  }

  send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** 提交引擎 Action（playerId 由 server 注入） */
  sendAction(action: Record<string, unknown>): void {
    this.send({ type: "action", action });
  }

  /** 交互挂起选择（resolvePrompt，playerId 由 server 推断） */
  sendResolvePrompt(choice: string | string[]): void {
    this.send({ type: "resolvePrompt", choice });
  }

  close(): void {
    this.ws?.close();
  }
}
