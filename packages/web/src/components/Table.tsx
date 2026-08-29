/**
 * 票据 15 — 牌桌快照渲染（最小可玩链路）。
 *
 * 数据源：server 下发的裁剪快照（redactState 输出），全部 props 驱动。
 * - 本人手牌/弃牌区可操作选中，按阶段发送对应 Action；
 * - 黑市槽点击购买；PendingPromptBanner 接交互挂起（onResolve → sendResolvePrompt）。
 * 遗留：黑市牌名暂以 defId 展示（server 未下发卡池元数据）；骰子动画未接入（无骰子事件流）。
 */
import { useState } from "react";
import type { Card, ZoneId } from "@crimson/engine";
import type { TablePlayer, ViewPendingPrompt } from "../lib/types.js";
import type { SnapState } from "../lib/ws.js";
import PendingPromptBanner from "./PendingPromptBanner.js";

export interface TableProps {
  snap: SnapState;
  you: string;
  onAction: (action: Record<string, unknown>) => void;
  onResolve: (choice: string | string[]) => void;
}

const PHASE_LABEL: Record<string, string> = {
  draw: "抽牌",
  swap: "换牌",
  play: "出牌",
  duel: "对决",
  settle: "结算",
  purchase: "购买",
  delete: "删牌",
  reshape: "重整",
};

const ZONE_LABEL: Record<string, string> = { hand: "手牌", discard: "弃牌区", play: "出牌区", deleted: "删牌区", draw: "抽牌堆" };

const SUIT_SYMBOL: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

function cardsOf(zone: { count: number } | { cards: Card[] }): Card[] {
  return "cards" in zone ? zone.cards : [];
}

function countOf(zone: { count: number } | { cards: Card[] }): number {
  return "cards" in zone ? zone.cards.length : zone.count;
}

/** 占位卡面：纯色块 + 点数/花色（图片缺失回退，与 05 原型一致） */
function CardFace({ card }: { card: Card }) {
  if (card.isJoker || card.suit === null || card.rank === null) {
    return <span className="joker-text">JOKER</span>;
  }
  const red = card.suit === "H" || card.suit === "D";
  return (
    <>
      <span className={`suit${red ? " red" : ""}`}>{SUIT_SYMBOL[card.suit]}</span>
      <span className={`rank${red ? " red" : ""}`}>{card.rank}</span>
    </>
  );
}

export default function Table({ snap, you, onAction, onResolve }: TableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const myPlayer = snap.players.find((p) => p.id === you);
  const players: TablePlayer[] = snap.players.map((p) => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    characterId: p.characterId,
    chips: p.chips,
    tickets: p.tickets,
  }));

  const myHand = myPlayer ? cardsOf(myPlayer.zones.hand) : [];
  const myDiscard = myPlayer ? cardsOf(myPlayer.zones.discard) : [];
  const passHolder = snap.players.find((p) => p.seat === snap.passHolderSeat);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(type: "swap" | "playCards" | "deleteCards", zoneCards: Card[]) {
    const ids = zoneCards.filter((c) => selected.has(c.id)).map((c) => c.id);
    if (ids.length === 0) return;
    onAction({ type, ...(type === "swap" ? { discardIds: ids } : type === "playCards" ? { cardIds: ids } : { cardIds: ids }) });
    setSelected(new Set());
  }

  const swapLeft = myPlayer?.swapLeft ?? 0;
  const maxSelect = snap.phase === "swap" ? Math.min(3, swapLeft) : snap.phase === "play" ? 5 : 1;

  // 交互挂起：目标玩家见完整候选（本人视角），他人见 waitingFor
  const prompt = (snap.pendingPrompt as ViewPendingPrompt | null) ?? null;
  const cardsByZone: Partial<Record<ZoneId, Card[]>> = {
    hand: myHand,
    discard: myDiscard,
    play: myPlayer ? cardsOf(myPlayer.zones.play) : [],
    deleted: myPlayer ? cardsOf(myPlayer.zones.deleted) : [],
  };

  if (snap.finished) {
    return (
      <div className="table">
        <h2 className="table-title">对局结束</h2>
        <p className="result">
          胜者：{snap.winners.map((w) => snap.players.find((p) => p.id === w)?.name ?? w).join("、")}
        </p>
        <Log log={snap.log} />
      </div>
    );
  }

  return (
    <div className="table">
      <div className="table-header">
        <span className="table-turn">第 {snap.turn} 回合</span>
        <span className="table-phase">阶段：{PHASE_LABEL[snap.phase] ?? snap.phase}</span>
        {passHolder ? <span className="table-pass">临时特权证：{passHolder.name}</span> : null}
        <span className="table-supply">黑市供应堆 {snap.blackMarket.supplyCount} 张</span>
      </div>

      {/* 对手信息条 */}
      <div className="players-row">
        {snap.players
          .filter((p) => p.id !== you)
          .map((p) => (
            <div key={p.id} className="player-box">
              <span className="avatar">{p.name.slice(0, 1)}</span>
              <span className="opt-name">{p.name}</span>
              <span className="opt-sub">
                {p.chips} 筹 · {p.tickets} 票 · 手牌 {countOf(p.zones.hand)} 张
                {p.characterId ? ` · ${p.characterId}` : ""}
              </span>
            </div>
          ))}
      </div>

      {/* 交互挂起横幅（14 组件，onResolve 接 WS） */}
      <PendingPromptBanner
        prompt={prompt}
        myPlayerId={you}
        players={players}
        cardsByZone={cardsByZone}
        onResolve={onResolve}
      />

      {/* 黑市区 */}
      <div className="section">
        <h3 className="section-title">黑市区</h3>
        <div className="market-row">
          {snap.blackMarket.slots.map((slot, i) => (
            <button
              key={i}
              type="button"
              className={`market-slot${snap.phase === "purchase" && slot.defId ? "" : " dim"}`}
              disabled={snap.phase !== "purchase" || !slot.defId}
              onClick={() => onAction({ type: "purchase", slotIndex: i })}
            >
              <span className="market-def">{slot.defId ?? "—"}</span>
              {slot.subtype ? <span className="market-sub">{slot.subtype}</span> : null}
              <span className="market-price">{slot.price} 筹</span>
              {slot.bonusChips > 0 ? <span className="market-bonus">+{slot.bonusChips} 叠加</span> : null}
            </button>
          ))}
        </div>
      </div>

      {/* 我的手牌 / 操作区 */}
      <div className="section">
        <h3 className="section-title">我的手牌（{myHand.length}）{selected.size > 0 ? ` · 已选 ${selected.size}/${maxSelect}` : ""}</h3>
        <div className="hand-row">
          {myHand.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`card${selected.has(c.id) ? " sel" : ""}`}
              onClick={() => toggle(c.id)}
              disabled={snap.phase !== "swap" && snap.phase !== "play"}
            >
              <span className="check">{selected.has(c.id) ? "✓" : ""}</span>
              <CardFace card={c} />
            </button>
          ))}
          {myHand.length === 0 ? <span className="prompt-text">手牌为空</span> : null}
        </div>

        <div className="phase-actions">
          {snap.phase === "swap" ? (
            <>
              <button type="button" className="btn" disabled={selected.size === 0} onClick={() => submit("swap", myHand)}>
                换牌（{selected.size}）
              </button>
              <button type="button" className="btn gold" onClick={() => onAction({ type: "stopSwap" })}>
                停止换牌（余 {swapLeft} 次换 {swapLeft} 筹）
              </button>
            </>
          ) : null}
          {snap.phase === "play" ? (
            <button type="button" className="btn gold" disabled={selected.size === 0} onClick={() => submit("playCards", myHand)}>
              出牌（{selected.size}）
            </button>
          ) : null}
          {snap.phase === "purchase" ? (
            <button type="button" className="btn" onClick={() => onAction({ type: "skipPurchase" })}>
              跳过购买
            </button>
          ) : null}
          {snap.phase === "delete" ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={selected.size === 0}
                onClick={() => submit("deleteCards", myDiscard)}
              >
                删除弃牌区（{selected.size}）
              </button>
              <button type="button" className="btn gold" onClick={() => onAction({ type: "ready" })}>
                完成
              </button>
            </>
          ) : null}
          {snap.phase === "reshape" ? (
            <>
              <button type="button" className="btn" onClick={() => onAction({ type: "reshape", reshuffle: true })}>
                重洗牌库
              </button>
              <button type="button" className="btn gold" onClick={() => onAction({ type: "reshape", reshuffle: false })}>
                +2 血筹
              </button>
            </>
          ) : null}
          {["draw", "duel", "settle"].includes(snap.phase) ? (
            <span className="prompt-text">
              {PHASE_LABEL[snap.phase] ?? snap.phase}阶段自动进行，无需操作
            </span>
          ) : null}
        </div>

        {/* 弃牌区/出牌区概览 */}
        {myPlayer ? (
          <div className="zone-strip">
            <span className="zone-chip">
              {myPlayer.chips} 筹 · {myPlayer.tickets} 票
            </span>
            <span className="zone-chip">弃牌区 {countOf(myPlayer.zones.discard)}</span>
            <span className="zone-chip">删牌区 {countOf(myPlayer.zones.deleted)}</span>
            <span className="zone-chip">抽牌堆 {countOf(myPlayer.zones.draw)}</span>
            <span className="zone-chip">道具 {myPlayer.zones.items.length}</span>
            <span className="zone-chip">
              芯片 {Object.keys(myPlayer.zones.chips).length}
              {Object.keys(myPlayer.zones.chips).length > 0 ? `（${Object.values(myPlayer.zones.chips).join(",")}）` : ""}
            </span>
          </div>
        ) : null}
      </div>

      <Log log={snap.log} />
    </div>
  );
}

function Log({ log }: { log: SnapState["log"] }) {
  return (
    <div className="section">
      <h3 className="section-title">对局日志</h3>
      <ul className="log-list">
        {log.slice(-12).map((l, i) => (
          <li key={i} className="log-entry">
            <span className="log-meta">
              T{l.turn}·{ZONE_LABEL[l.phase] ?? l.phase}
            </span>
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
