import { useEffect, useRef, useState } from "react";
import { ENGINE_VERSION, type CardPool } from "@crimson/engine";
import type { RoomView, SnapState } from "./lib/ws.js";
import { GameClient, defaultWsUrl } from "./lib/ws.js";
import Lobby from "./components/Lobby.js";
import Table from "./components/Table.js";

type Mode = "easy" | "standard" | "solo";

interface ModeEntry {
  id: Mode;
  name: string;
  desc: string;
  tag: string;
  /** false = 灰显「敬请期待 M3」（grilling Q6 决策） */
  available: boolean;
}

const TOKEN_KEY = "crimson.stare.token";

/** 模式选择。简易模式已接入 15 号票据联调链路，其余灰显。 */
const MODES: ModeEntry[] = [
  {
    id: "easy",
    name: "简易模式",
    desc: "固定 4 角色 + 24 张黄边黑市牌，快速上手",
    tag: "推荐新手",
    available: true,
  },
  {
    id: "standard",
    name: "标准模式",
    desc: "2-4 人标准局，完整构筑",
    tag: "敬请期待 M3",
    available: false,
  },
  {
    id: "solo",
    name: "单人模式",
    desc: "挑战机械荷官 Doloris / Timoris / Mortis",
    tag: "敬请期待 M3",
    available: false,
  },
];

type Stage = "mode" | "conn" | "lobby" | "table";

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [stage, setStage] = useState<Stage>("mode");
  const [name, setName] = useState("");
  const [wsUrl, setWsUrl] = useState("");
  const [room, setRoom] = useState<RoomView | null>(null);
  const [snap, setSnap] = useState<SnapState | null>(null);
  const [you, setYou] = useState("");
  /** 卡池元数据（票据 19）：hello 后随 cardPool 消息下发一次，静态数据 */
  const [pool, setPool] = useState<CardPool | null>(null);
  const [error, setError] = useState("");
  const clientRef = useRef<GameClient | null>(null);

  useEffect(() => {
    return () => clientRef.current?.close();
  }, []);

  function connect() {
    if (!name.trim()) {
      setError("请输入昵称");
      return;
    }
    setError("");
    const client = new GameClient({
      url: wsUrl.trim() || defaultWsUrl(),
      name: name.trim(),
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
      onMessage: (msg) => {
        switch (msg.type) {
          case "welcome":
            localStorage.setItem(TOKEN_KEY, msg.token);
            break;
          case "cardPool":
            setPool(msg.pool);
            break;
          case "roomState":
            setRoom(msg.room);
            setStage(msg.room.started ? "table" : "lobby");
            break;
          case "snapshot":
            setSnap(msg.state);
            setYou(msg.you);
            setStage("table");
            break;
          case "leftRoom":
            // 已离开/房间解散：回大厅（可再建房）
            setRoom(null);
            setSnap(null);
            setStage("lobby");
            break;
          case "error":
            setError(msg.message);
            break;
        }
      },
      onClose: () => setError("连接已断开"),
    });
    clientRef.current = client;
    client.connect().then(
      () => setStage("lobby"),
      (e: Error) => setError(e.message),
    );
  }

  function send(msg: unknown) {
    clientRef.current?.send(msg);
  }

  function onAction(action: Record<string, unknown>) {
    clientRef.current?.sendAction(action);
  }

  function onResolve(choice: string | string[]) {
    clientRef.current?.sendResolvePrompt(choice);
  }

  /** 断开连接并返回模式选择（退出房间/退出大厅出口，票据 16） */
  function disconnect() {
    clientRef.current?.close();
    clientRef.current = null;
    setRoom(null);
    setSnap(null);
    setYou("");
    setError("");
    setStage("mode");
  }

  return (
    <div className="app-root">
      <h1 className="app-title">血色牌局</h1>
      <p className="app-sub">归乡特快 · 简易模式在线对局（engine v{ENGINE_VERSION}）</p>

      {stage === "mode" ? (
        <div className="mode-select">
          {MODES.map((m) =>
            m.available ? (
              <button
                key={m.id}
                type="button"
                className="mode-card available"
                onClick={() => {
                  setMode(m.id);
                  setStage("conn");
                }}
              >
                <span className="mode-name">{m.name}</span>
                <span className="mode-tag">{m.tag}</span>
                <span className="mode-desc">{m.desc}</span>
              </button>
            ) : (
              <div key={m.id} className="mode-card disabled" aria-disabled="true">
                <span className="mode-name">{m.name}</span>
                <span className="coming-soon">{m.tag}</span>
                <span className="mode-desc">{m.desc}</span>
              </div>
            ),
          )}
        </div>
      ) : null}

      {stage === "conn" && mode === "easy" ? (
        <div className="conn-form">
          <h2 className="lobby-title">连接对局服务器</h2>
          <input
            className="text-input"
            placeholder="昵称"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="text-input"
            placeholder={`服务器地址（默认 ${defaultWsUrl()}）`}
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
          />
          <div className="lobby-actions">
            <button type="button" className="btn gold" onClick={connect}>
              连接
            </button>
            <button type="button" className="btn" onClick={disconnect}>
              返回
            </button>
          </div>
        </div>
      ) : null}

      {stage === "lobby" ? (
        <Lobby
          room={room}
          myPlayerId={clientRef.current?.playerId ?? ""}
          onCreate={() => send({ type: "createRoom", mode: "easy" })}
          onJoin={(roomId) => send({ type: "joinRoom", roomId })}
          onStart={() => send({ type: "startGame" })}
          onLeave={() => send({ type: "leaveRoom" })}
          onDisconnect={disconnect}
        />
      ) : null}

      {stage === "table" && snap ? (
        <Table snap={snap} you={you} pool={pool} onAction={onAction} onResolve={onResolve} />
      ) : null}

      {error ? (
        <p className="app-error">
          错误：{error}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setError("");
              setStage("mode");
            }}
          >
            返回
          </button>
        </p>
      ) : null}
    </div>
  );
}
