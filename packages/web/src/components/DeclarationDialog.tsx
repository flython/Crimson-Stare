/**
 * 票据 22 — 暗扣声明面板。
 *
 * 出牌时若所选手牌含声明类芯片（变色墨水/黑色芯片/红色芯片/数字滑轨/百变影像），
 * 弹出本面板让玩家填写每张牌的声明值，随 playCards 一起提交到 engine。
 *
 * 声明值格式（与 engine parseDeclaredSuit/parseDeclaredRank 对齐）：
 * - 变色墨水(008)：花色字母 S/H/D/C 或 "any"
 * - 黑色芯片(009)：S 或 C（♠/♣）
 * - 红色芯片(010)：H 或 D（♥/♦）
 * - 数字滑轨(011)："any" 或数字 "2".."14"
 * - 百变影像(012)："any" 或 "suit:S,rank:7" 格式
 */
import { useState } from "react";
import type { Card, CardDef } from "@crimson/engine";

const SUIT_SYMBOL: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const SUIT_NAMES: Record<string, string> = { S: "黑桃", H: "红桃", D: "方片", C: "草花" };

interface DeclaredCard {
  card: Card;
  chipDefId: string;
  chipDef: CardDef;
  /** 当前声明值 */
  value: string;
}

interface DeclarationDialogProps {
  cards: Array<{ card: Card; chipDefId: string; chipDef: CardDef }>;
  onConfirm: (declarations: Record<string, string>) => void;
  onCancel: () => void;
}

function SuitPicker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            style={{
              padding: "4px 10px",
              border: value === s ? "2px solid #e9404b" : "1px solid #583c42",
              borderRadius: 4,
              background: value === s ? "#3c1f22" : "transparent",
              color: "#ffc840",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {SUIT_SYMBOL[s] ?? s} {SUIT_NAMES[s] ?? s}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange("any")}
          style={{
            padding: "4px 10px",
            border: value === "any" ? "2px solid #e9404b" : "1px solid #583c42",
            borderRadius: 4,
            background: value === "any" ? "#3c1f22" : "transparent",
            color: "#ffc840",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          任意花色
        </button>
      </div>
    </div>
  );
}

function RankPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const ranks = Array.from({ length: 13 }, (_, i) => String(i + 2));
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {ranks.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            style={{
              width: 32,
              height: 32,
              border: value === r ? "2px solid #e9404b" : "1px solid #583c42",
              borderRadius: 4,
              background: value === r ? "#3c1f22" : "transparent",
              color: "#ffc840",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {r}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange("any")}
          style={{
            padding: "0 8px",
            height: 32,
            border: value === "any" ? "2px solid #e9404b" : "1px solid #583c42",
            borderRadius: 4,
            background: value === "any" ? "#3c1f22" : "transparent",
            color: "#ffc840",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          任意
        </button>
      </div>
    </div>
  );
}

function JokerPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => onChange("any")}
          style={{
            padding: "4px 10px",
            border: value === "any" ? "2px solid #e9404b" : "1px solid #583c42",
            borderRadius: 4,
            background: value === "any" ? "#3c1f22" : "transparent",
            color: "#ffc840",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          任意（等价 JOKER）
        </button>
      </div>
      <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
        百变影像也可指定固定花色+点数（选上方花色+点数组合）
      </div>
    </div>
  );
}

export default function DeclarationDialog({ cards, onConfirm, onCancel }: DeclarationDialogProps) {
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const { card, chipDefId } of cards) {
      // 默认值：变色墨水→any，数字滑轨→any，百变影像→any，黑色/红色芯片→各自的第一个选项
      if (chipDefId === "008") init[card.id] = "any";
      else if (chipDefId === "009") init[card.id] = "S";
      else if (chipDefId === "010") init[card.id] = "H";
      else if (chipDefId === "011") init[card.id] = "any";
      else if (chipDefId === "012") init[card.id] = "any";
      else init[card.id] = "any";
    }
    return init;
  });

  function setVal(cardId: string, v: string) {
    setVals((prev) => ({ ...prev, [cardId]: v }));
  }

  function handleConfirm() {
    // 验证：变色墨水/黑色/红色芯片必须选一个花色（不能是 any？）
    // 其实 "any" 对变色墨水是合法的，engine 也接受
    onConfirm(vals);
  }

  const suitChips = ["008", "009", "010"];
  const rankChips = ["011"];
  const jokerChips = ["012"];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "#1a0f12",
          border: "1px solid #e9404b",
          borderRadius: 8,
          padding: "20px 24px",
          maxWidth: 480,
          width: "90%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <h3 style={{ color: "#ffc840", margin: "0 0 4px", fontSize: 16 }}>
          芯片声明
        </h3>
        <p style={{ color: "#a88", fontSize: 12, margin: "0 0 16px" }}>
          所选牌含声明类芯片，请为每张牌选择声明值（判定时生效）
        </p>

        {cards.map(({ card, chipDefId, chipDef }) => {
          const red = card.suit === "H" || card.suit === "D";
          const suitSym = card.suit ? SUIT_SYMBOL[card.suit] : "";
          const rankStr = card.rank ?? "JOKER";
          const cardLabel = `${suitSym}${rankStr} ${chipDef.name}`;

          return (
            <div
              key={card.id}
              style={{
                background: "#2a1518",
                border: "1px solid #583c42",
                borderRadius: 6,
                padding: "10px 12px",
                marginBottom: 10,
              }}
            >
              <div style={{ color: "#ffc840", fontSize: 13, marginBottom: 8 }}>
                {cardLabel}
              </div>
              <div style={{ color: "#a88", fontSize: 11, marginBottom: 8 }}>
                {chipDef.effectText}
              </div>

              {suitChips.includes(chipDefId) && (
                <SuitPicker
                  label="声明花色"
                  value={vals[card.id] ?? "any"}
                  onChange={(v) => setVal(card.id, v)}
                  options={chipDefId === "009" ? ["S", "C"] : chipDefId === "010" ? ["H", "D"] : ["S", "H", "D", "C"]}
                />
              )}
              {rankChips.includes(chipDefId) && (
                <RankPicker
                  label="声明点数"
                  value={vals[card.id] ?? "any"}
                  onChange={(v) => setVal(card.id, v)}
                />
              )}
              {jokerChips.includes(chipDefId) && (
                <JokerPicker
                  label="百变影像（视为任意花色+点数，等价 JOKER）"
                  value={vals[card.id] ?? "any"}
                  onChange={(v) => setVal(card.id, v)}
                />
              )}
            </div>
          );
        })}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              border: "1px solid #583c42",
              borderRadius: 4,
              background: "transparent",
              color: "#a88",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            取消出牌
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            style={{
              padding: "8px 20px",
              border: "1px solid #e9404b",
              borderRadius: 4,
              background: "#3c1f22",
              color: "#ffc840",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            确认并出牌
          </button>
        </div>
      </div>
    </div>
  );
}
