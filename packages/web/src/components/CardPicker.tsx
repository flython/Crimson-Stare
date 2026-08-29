import { useState } from "react";
import type { Card, ZoneId } from "@crimson/engine";

const SUIT_SYMBOL: Record<string, string> = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣",
};

/** 区域名展示（chooseCard 的 from） */
export const ZONE_LABEL: Record<ZoneId, string> = {
  hand: "手牌",
  discard: "弃牌区",
  draw: "抽牌堆",
  play: "出牌区",
  deleted: "删牌区",
};

export interface CardPickerProps {
  /** 候选牌实例 id（engine pendingPrompt.candidates，chooseCard） */
  candidates: string[];
  /** 来源区域 */
  from: ZoneId;
  /** 区域内全部牌（我方可见的完整列表，含非候选；draw 对我亦不可见时由调用方传空/摘要） */
  cards: Card[];
  /** 是否多选（默认 true，chooseCard 支持多选） */
  multiSelect?: boolean;
  /** 交互提示文案（promptText） */
  promptText?: string;
  /** 确认选择 → 回调选中牌 id 数组 */
  onConfirm: (cardIds: string[]) => void;
  /** 取消交互 */
  onCancel?: () => void;
}

/** 占位卡牌面：纯色块 + 点数/花色文本（图片缺失时回退，与 05 原型 .card 一致） */
function CardFace({ card }: { card: Card }) {
  if (card.isJoker) {
    return <span className="joker-text">JOKER</span>;
  }
  const suit = card.suit;
  const rank = card.rank;
  if (suit === null || rank === null) {
    return <span className="joker-text">JOKER</span>;
  }
  const red = suit === "H" || suit === "D";
  return (
    <>
      <span className={`suit${red ? " red" : ""}`}>{SUIT_SYMBOL[suit]}</span>
      <span className={`rank${red ? " red" : ""}`}>{rank}</span>
    </>
  );
}

/**
 * CardPicker — 选牌（pendingPrompt.kind === "chooseCard"）。
 * 从指定区域（hand/discard 等）展示候选牌，支持多选（checkbox 风格）与确认；
 * 非候选牌置灰不可选。弹层模式同 TargetPicker。
 */
export default function CardPicker({
  candidates,
  from,
  cards,
  multiSelect = true,
  promptText,
  onConfirm,
  onCancel,
}: CardPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const pickable = new Set(candidates);
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  // 候选里出现但未能在区域牌中解析出牌面（如 draw 对我也不可见）→ 用 id 兜底渲染
  const missing = candidates.filter((id) => !cardsById.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (!multiSelect) next.clear();
        next.add(id);
      }
      return next;
    });
  }

  const confirmable = selected.size > 0;

  return (
    <div className="overlay" onClick={onCancel ? () => onCancel() : undefined}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          请选择牌 · {ZONE_LABEL[from]}
          {multiSelect ? "（可多选）" : ""}
        </h3>
        {promptText ? <p className="prompt-text">{promptText}</p> : null}
        <div className="picker-grid">
          {cards.map((c) => {
            const canPick = pickable.has(c.id);
            const isSel = selected.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={`card${isSel ? " sel" : ""}${canPick ? "" : " dim"}`}
                disabled={!canPick}
                onClick={() => toggle(c.id)}
                aria-label={`${isSel ? "已选" : "未选"} ${c.rank ?? "JOKER"}${c.suit ?? ""}`}
              >
                {multiSelect ? <span className="check">{isSel ? "✓" : ""}</span> : null}
                <CardFace card={c} />
              </button>
            );
          })}
          {missing.map((id) => {
            const isSel = selected.has(id);
            return (
              <button
                key={id}
                type="button"
                className={`card joker${isSel ? " sel" : ""}`}
                onClick={() => toggle(id)}
              >
                {multiSelect ? <span className="check">{isSel ? "✓" : ""}</span> : null}
                <span className="joker-text">{id.slice(0, 4)}</span>
              </button>
            );
          })}
          {cards.length === 0 && missing.length === 0 ? (
            <p className="prompt-text">该区域没有可选的牌。</p>
          ) : null}
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
            disabled={!confirmable}
            onClick={() => onConfirm([...selected])}
          >
            确认选择{multiSelect && confirmable ? `（${selected.size}）` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
