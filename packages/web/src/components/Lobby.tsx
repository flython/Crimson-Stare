/**
 * 票据 15 — 简易大厅：建房 / 入房 / 成员列表 / 房主开始。
 * 数据源为服务端 roomState（协议 v1），props 驱动，不做本地业务逻辑。
 */
import { useState } from "react";
import type { RoomView } from "../lib/ws.js";

export interface LobbyProps {
  room: RoomView | null;
  myPlayerId: string;
  onCreate: () => void;
  onJoin: (roomId: string) => void;
  onStart: () => void;
  /** 离开当前房间（票据 16：房主离开=解散） */
  onLeave: () => void;
  /** 断开连接并返回模式选择 */
  onDisconnect: () => void;
}

export default function Lobby({ room, myPlayerId, onCreate, onJoin, onStart, onLeave, onDisconnect }: LobbyProps) {
  const [roomId, setRoomId] = useState("");
  const [joining, setJoining] = useState(false);

  if (!room) {
    return (
      <div className="lobby">
        <h2 className="lobby-title">简易模式 · 大厅</h2>
        <p className="lobby-sub">固定 4 角色 + 24 张黄边黑市牌，2-4 人快速上手</p>
        <div className="lobby-actions">
          <button type="button" className="btn gold" onClick={onCreate}>
            创建房间
          </button>
        </div>
        <div className="lobby-join">
          <input
            className="text-input"
            placeholder="输入房间号加入"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={!roomId.trim() || joining}
            onClick={() => {
              setJoining(true);
              onJoin(roomId.trim());
            }}
          >
            加入房间
          </button>
        </div>
        <div className="lobby-actions">
          <button type="button" className="btn" onClick={onDisconnect}>
            断开连接
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby">
      <h2 className="lobby-title">
        房间 {room.roomId}
        <span className="lobby-mode">
          {room.mode === "easy" ? "简易模式" : room.mode === "solo" ? "单人模式" : room.mode}
        </span>
      </h2>
      <ul className="lobby-players">
        {room.players.map((p) => (
          <li key={p.playerId} className={`lobby-player${!p.connected ? " offline" : ""}`}>
            <span className="avatar">{p.name.slice(0, 1) || "?"}</span>
            <span className="opt-name">
              {p.name}
              {p.playerId === myPlayerId ? "（我）" : ""}
              {p.playerId === room.ownerId ? "（房主）" : ""}
              {(p.name === "Doloris" || p.name === "Timoris" || p.name === "Mortis") && "（荷官）"}
            </span>
            {!p.connected ? <span className="lobby-offline">离线</span> : null}
          </li>
        ))}
      </ul>
      {room.ownerId === myPlayerId && !room.started ? (
        <div className="lobby-actions">
          <button type="button" className="btn gold" disabled={room.players.length < 2} onClick={onStart}>
            开始游戏{room.players.length < 2 ? "（至少 2 人）" : ""}
          </button>
          <button type="button" className="btn" onClick={onLeave}>
            解散房间
          </button>
        </div>
      ) : room.started ? (
        <p className="lobby-note">对局进行中…</p>
      ) : room.mode === "solo" ? (
        <p className="lobby-note">正在连接荷官…</p>
      ) : (
        <div className="lobby-actions">
          <p className="lobby-note">等待房主开始…</p>
          <button type="button" className="btn" onClick={onLeave}>
            离开房间
          </button>
        </div>
      )}
    </div>
  );
}
