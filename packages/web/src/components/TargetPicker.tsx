import { useState } from "react";
import type { TablePlayer } from "../lib/types.js";

export interface TargetPickerProps {
  /** 候选玩家 id 列表（engine pendingPrompt.candidates，choosePlayer） */
  candidates: string[];
  /** 牌桌玩家信息（头像/名字/座位/资源） */
  players: TablePlayer[];
  /** 交互提示文案（promptText） */
  promptText?: string;
  /** 确认选择 → 回调被选中玩家 id */
  onConfirm: (playerId: string) => void;
  /** 取消交互（调用方自行决定是否不 resolve 等托管） */
  onCancel?: () => void;
}

/**
 * TargetPicker — 选玩家（pendingPrompt.kind === "choosePlayer"）。
 * 高亮候选玩家头像/座位，点击单选 + 确认按钮；非候选玩家置灰不可点。
 * 弹层复用 05 原型的 overlay/modal 模式，点击目标 ≥44px，触屏+鼠标通用。
 */
export default function TargetPicker({
  candidates,
  players,
  promptText,
  onConfirm,
  onCancel,
}: TargetPickerProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const byId = new Map(players.map((p) => [p.id, p]));
  const pickable = new Set(candidates);

  return (
    <div className="overlay" onClick={onCancel ? () => onCancel() : undefined}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>请选择目标玩家</h3>
        {promptText ? <p className="prompt-text">{promptText}</p> : null}
        <div className="picker-grid">
          {players.map((p) => {
            const canPick = pickable.has(p.id);
            const isSel = selected === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`picker-opt${isSel ? " sel" : ""}${canPick ? "" : " dim"}`}
                disabled={!canPick}
                onClick={() => setSelected(p.id)}
              >
                <span className="avatar">{p.name.slice(0, 1) || "?"}</span>
                <span className="opt-name">{p.name}</span>
                <span className="opt-sub">
                  {p.chips} 筹 · {p.tickets} 票
                </span>
              </button>
            );
          })}
          {/* 防御：候选 id 不在玩家列表时仍给出可选项（正常不会发生） */}
          {candidates
            .filter((id) => !byId.has(id))
            .map((id) => (
              <button
                key={id}
                type="button"
                className={`picker-opt${selected === id ? " sel" : ""}`}
                onClick={() => setSelected(id)}
              >
                <span className="avatar">?</span>
                <span className="opt-name">{id}</span>
                <span className="opt-sub">（未加入玩家）</span>
              </button>
            ))}
        </div>
        <div className="picker-actions">
          {onCancel ? (
            <button type="button" className="btn ghost" onClick={onCancel}>
              取消
            </button>
          ) : null}
          <button
            type="button"
            className="btn gold"
            disabled={selected === null}
            onClick={() => {
              if (selected !== null) onConfirm(selected);
            }}
          >
            确认选择
          </button>
        </div>
      </div>
    </div>
  );
}
