/**
 * 票据 17 — 牌桌 UI 对齐原型 v4（四向实体牌桌）。
 *
 * 数据源：server 下发的裁剪快照（redactState 输出），props 驱动。
 * - 布局参照 `prototypes/table-ui.html`（05 号拍板基线）：顶栏阶段条 → 四向牌桌
 *   grid（top/left/center/right/me）→ 我的操作台（手牌多选 + 阶段操作 + 概览）。
 * - 交互逻辑沿用 15 号最小可玩版：手牌/弃牌区选中、按阶段发送对应 Action、
 *   黑市槽点击购买、PendingPromptBanner 接交互挂起（onResolve → sendResolvePrompt）。
 * 遗留：黑市牌名暂以 defId 展示、分类色暂以 subtype 映射（server 未下发卡池元数据）。
 */
import { useState } from "react";
import type { Card, ZoneId } from "@crimson/engine";
import type { TablePlayer, ViewPendingPrompt } from "../lib/types.js";
import type { SnapState } from "../lib/ws.js";
import PendingPromptBanner from "./PendingPromptBanner.js";
import CardPicker from "./CardPicker.js";

export interface TableProps {
  snap: SnapState;
  you: string;
  onAction: (action: Record<string, unknown>) => void;
  onResolve: (choice: string | string[]) => void;
}

type SnapPlayer = SnapState["players"][number];
type SeatDir = "top" | "left" | "right";

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

/** 阶段条顺序（与原型 PHASES 一致） */
const PHASES = ["draw", "swap", "play", "duel", "settle", "purchase", "delete", "reshape"] as const;

const ZONE_LABEL: Record<string, string> = { hand: "手牌", discard: "弃牌区", play: "出牌区", deleted: "删牌区", draw: "抽牌堆" };

const SUIT_SYMBOL: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

/** 目标车票（对齐 DEFAULT_GAME_CONFIG.ticketGoals；config 未下发，前端固定映射） */
const TICKET_GOAL: Record<number, number> = { 2: 24, 3: 20, 4: 16 };

/** 他人手牌背面最多渲染个数（防止手牌过多撑爆座位） */
const MAX_HAND_BACKS = 8;

function cardsOf(zone: { count: number } | { cards: Card[] }): Card[] {
  return "cards" in zone ? zone.cards : [];
}

function countOf(zone: { count: number } | { cards: Card[] }): number {
  return "cards" in zone ? zone.cards.length : zone.count;
}

/**
 * 相对座位 → 方位。我固定坐底部（me），按顺时针间隔分配：
 * 2 人局唯一对手 → 对面 top；3 人局 1→左、2→右；4 人局 1→左、2→上、3→右。
 */
function seatDirOf(mySeat: number, count: number, seat: number): SeatDir {
  const d = (seat - mySeat + count) % count;
  if (count === 2) return "top";
  if (count === 4) {
    if (d === 1) return "left";
    if (d === 2) return "top";
    return "right";
  }
  return d === 1 ? "left" : "right";
}

/** 黑市卡分类色：subtype → 边框色（原型五分类元数据未下发，暂以 subtype 映射，遗留见票据 17 Answer） */
function subtypeCat(subtype?: string): string {
  if (subtype === "强化芯片") return "cat-chip";
  if (subtype === "秘密交易") return "cat-deal";
  if (subtype === "道具") return "cat-item";
  return "cat-generic";
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

/** 座位信息条：角色卡（占位点击查看技能，元数据未下发仅提示）+ 名字/徽章 + 票筹换牌牌库统计 + 手牌 */
function SeatInfo({
  p,
  goal,
  isPass,
  active,
  isMe,
}: {
  p: SnapPlayer;
  goal: number;
  isPass: boolean;
  active: boolean;
  isMe: boolean;
}) {
  const handCount = countOf(p.zones.hand);
  const backs = Math.min(handCount, MAX_HAND_BACKS);
  return (
    <div className={`seatInfo${active ? " active" : ""}`}>
      <div className="charCard" title="查看角色技能">
        {p.characterId?.slice(-3) ?? p.name.slice(0, 1)}
      </div>
      <div className="name">
        {p.name}
        {isPass ? <span className="badge">特权证</span> : null}
        {p.purchaseFlipped ? <span className="badge flip">已翻面</span> : null}
        {p.phaseReady ? <span className="endedTag">✓ 已结束</span> : null}
      </div>
      <div className="stat">
        <span>
          <span className="ticketIcon" /> 票 <b>{p.tickets}</b>/{goal}
        </span>
        <span>
          <span className="chipIcon" /> 筹 <b>{p.chips}</b>
        </span>
        <span>
          换牌 <b>{p.swapLeft}</b>
        </span>
        <span>
          牌库 <b>{countOf(p.zones.draw)}</b>
        </span>
        {isMe ? (
          <span>
            手牌 <b>{handCount}</b>
          </span>
        ) : (
          <span>
            手牌
            <span className="handBacks">
              {Array.from({ length: backs }, (_, i) => (
                <span key={i} className="mini-back" />
              ))}
              {handCount > MAX_HAND_BACKS ? <span className="moreBacks">+{handCount - MAX_HAND_BACKS}</span> : null}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

/** 出牌区：位于座位与中央之间（玩家"面前"）；左右座位牌旋转，top 座位 180° */
function PlayZone({ dir, p }: { dir: SeatDir | "me"; p?: SnapPlayer }) {
  const rot = dir === "left" ? "rot90" : dir === "right" ? "rot-90" : dir === "top" ? "rot180" : "";
  const cards = p ? cardsOf(p.zones.play) : [];
  const who = p ? p.name : "";
  return (
    <div className="playZone">
      <span className="pwho">{who || (dir === "me" ? "你" : "")}</span>
      {cards.length === 0 ? (
        <span className="emptyHint">{dir === "me" ? "出牌区" : "等待出牌…"}</span>
      ) : (
        cards.map((c) => (
          <span key={c.id} className={rot}>
            <span className="card small">
              <CardFace card={c} />
            </span>
          </span>
        ))
      )}
    </div>
  );
}

/** 黑市卡：defId + 分类色边框 + 价格 + 叠加血筹角标（购买阶段可点） */
function MarketCard({
  slot,
  phase,
  onBuy,
}: {
  slot: SnapState["blackMarket"]["slots"][number];
  phase: string;
  onBuy: () => void;
}) {
  if (!slot.defId) return <div className="bm-card empty" />;
  const purchasable = phase === "purchase";
  return (
    <button
      type="button"
      className={`bm-card ${subtypeCat(slot.subtype)}${purchasable ? " buyable" : ""}`}
      disabled={!purchasable}
      onClick={onBuy}
    >
      {slot.bonusChips > 0 ? <span className="bonus">{slot.bonusChips}</span> : null}
      <span className="bmName">{slot.defId}</span>
      <span className="bmSub">{slot.subtype ?? ""}</span>
      <span className="bmPrice">
        <span>{slot.price}筹</span>
        <span>{slot.subtype ?? ""}</span>
      </span>
    </button>
  );
}

/** 对局日志（复用现有渲染，样式对齐原型 logline） */
function Log({ log }: { log: SnapState["log"] }) {
  return (
    <div className="logPanel">
      <h3 className="panelTitle">对局日志</h3>
      {log.slice(-12).map((l, i) => (
        <div key={i} className="logline">
          <span className="logMeta">
            T{l.turn}·{ZONE_LABEL[l.phase] ?? l.phase}
          </span>{" "}
          {l.text}
        </div>
      ))}
    </div>
  );
}

export default function Table({ snap, you, onAction, onResolve }: TableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 删牌阶段：弃牌区选择弹层（复用 14 号 CardPicker，从弃牌区选牌删除） */
  const [deleteOpen, setDeleteOpen] = useState(false);

  const players: TablePlayer[] = snap.players.map((p) => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    characterId: p.characterId,
    chips: p.chips,
    tickets: p.tickets,
  }));

  const myPlayer = snap.players.find((p) => p.id === you);
  const mySeat = myPlayer?.seat ?? 0;
  const count = snap.players.length;
  const goal = TICKET_GOAL[count] ?? 16;

  const myHand = myPlayer ? cardsOf(myPlayer.zones.hand) : [];
  const myDiscard = myPlayer ? cardsOf(myPlayer.zones.discard) : [];
  const passHolder = snap.players.find((p) => p.seat === snap.passHolderSeat);

  /** 对手按方位分组（3 人局某方位空缺） */
  const seats: Record<SeatDir, SnapPlayer | undefined> = {
    top: undefined,
    left: undefined,
    right: undefined,
  };
  for (const p of snap.players) {
    if (p.id === you) continue;
    seats[seatDirOf(mySeat, count, p.seat)] = p;
  }

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
    onAction({ type, ...(type === "swap" ? { discardIds: ids } : { cardIds: ids }) });
    setSelected(new Set());
  }

  const swapLeft = myPlayer?.swapLeft ?? 0;

  // 交互挂起：目标玩家见完整候选（本人视角），他人见 waitingFor
  const prompt = (snap.pendingPrompt as ViewPendingPrompt | null) ?? null;
  const cardsByZone: Partial<Record<ZoneId, Card[]>> = {
    hand: myHand,
    discard: myDiscard,
    play: myPlayer ? cardsOf(myPlayer.zones.play) : [],
    deleted: myPlayer ? cardsOf(myPlayer.zones.deleted) : [],
  };

  // ===== 对局结束：胜者 + 日志 =====
  if (snap.finished) {
    return (
      <div className="table-root endPanel">
        <h2 className="endTitle">对局结束</h2>
        <p className="endWinner">
          胜者：{snap.winners.map((w) => snap.players.find((p) => p.id === w)?.name ?? w).join("、")}
        </p>
        <Log log={snap.log} />
      </div>
    );
  }

  const phaseIdx = PHASES.indexOf(snap.phase as (typeof PHASES)[number]);

  return (
    <div className="table-root">
      {/* 顶栏：回合 + 8 阶段条 + 目标票数 */}
      <div className="topbar">
        <span className="turnInfo">
          第 <b>{snap.turn}</b> 回合
        </span>
        <div className="phases">
          {PHASES.map((ph, i) => (
            <div key={ph} className={`ph${snap.phase === ph ? " cur" : i < phaseIdx ? " done" : ""}`}>
              {PHASE_LABEL[ph]}
            </div>
          ))}
        </div>
        <span className="goal">目标 {goal} 票</span>
      </div>

      {/* 挂起交互横幅（14 组件，onResolve 接 WS） */}
      <PendingPromptBanner
        prompt={prompt}
        myPlayerId={you}
        players={players}
        cardsByZone={cardsByZone}
        onResolve={onResolve}
      />

      {/* 实体牌桌：中心黑市 + 四向座位 */}
      <div className="tableWrap">
        <div className="table">
          <div className="seat seatTop">
            {seats.top ? (
              <>
                <SeatInfo p={seats.top} goal={goal} isPass={snap.passHolderSeat === seats.top.seat} active={!seats.top.phaseReady} isMe={false} />
                <PlayZone dir="top" p={seats.top} />
              </>
            ) : (
              <div className="seatInfo empty-seat">空位</div>
            )}
          </div>

          <div className="seat seatLeft">
            {seats.left ? (
              <>
                <PlayZone dir="left" p={seats.left} />
                <SeatInfo p={seats.left} goal={goal} isPass={snap.passHolderSeat === seats.left.seat} active={!seats.left.phaseReady} isMe={false} />
              </>
            ) : (
              <div className="seatInfo empty-seat">空位</div>
            )}
          </div>

          <div className="center">
            <div className="zoneTitle">
              <span>
                <b>黑 市</b>（购买阶段点卡片购买）
              </span>
              <span className="supplyInfo">供应堆 {snap.blackMarket.supplyCount} 张</span>
            </div>
            <div className="marketSlots">
              {snap.blackMarket.slots.map((slot, i) => (
                <MarketCard key={i} slot={slot} phase={snap.phase} onBuy={() => onAction({ type: "purchase", slotIndex: i })} />
              ))}
            </div>
            <div className="zoneTitle">购买阶段结束时最右两格叠加 1 血筹</div>
          </div>

          <div className="seat seatRight">
            {seats.right ? (
              <>
                <PlayZone dir="right" p={seats.right} />
                <SeatInfo p={seats.right} goal={goal} isPass={snap.passHolderSeat === seats.right.seat} active={!seats.right.phaseReady} isMe={false} />
              </>
            ) : (
              <div className="seatInfo empty-seat">空位</div>
            )}
          </div>

          <div className="seat seatMe">
            <PlayZone dir="me" p={myPlayer} />
            {myPlayer ? (
              <SeatInfo p={myPlayer} goal={goal} isPass={snap.passHolderSeat === myPlayer.seat} active={!myPlayer.phaseReady} isMe />
            ) : null}
          </div>
        </div>
      </div>

      {/* 我的操作台 */}
      <div className="console">
        <div className="consoleBar">
          <span className="name">
            你 · {myPlayer?.characterId ?? "?"}
            {passHolder && passHolder.id === you ? <span className="badge">临时特权证</span> : null}
            {myPlayer?.purchaseFlipped ? <span className="badge flip">已翻面</span> : null}
          </span>
          <div className="actions">
            {snap.phase === "swap" ? (
              <>
                <button type="button" className="btn" disabled={selected.size === 0} onClick={() => submit("swap", myHand)}>
                  换牌（弃{selected.size || 0}抽{selected.size || 0}）
                </button>
                <button type="button" className="btn ghost" onClick={() => onAction({ type: "stopSwap" })}>
                  停止（剩{swapLeft}次换{swapLeft}筹）
                </button>
              </>
            ) : null}
            {snap.phase === "play" ? (
              <button type="button" className="btn gold" disabled={selected.size === 0} onClick={() => submit("playCards", myHand)}>
                往前打出（暗扣 {selected.size || 0}/5）
              </button>
            ) : null}
            {snap.phase === "purchase" ? (
              <button type="button" className="btn" onClick={() => onAction({ type: "skipPurchase" })}>
                跳过购买
              </button>
            ) : null}
            {snap.phase === "delete" ? (
              <>
                <button type="button" className="btn" disabled={myDiscard.length === 0} onClick={() => setDeleteOpen(true)}>
                  删除弃牌区
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
                  不重洗 +2 血筹
                </button>
              </>
            ) : null}
            {["draw", "duel", "settle"].includes(snap.phase) ? (
              <span className="autoText">{PHASE_LABEL[snap.phase] ?? snap.phase}阶段自动进行</span>
            ) : null}
          </div>
        </div>

        <div className="hintRow">
          <span className="actionHint">
            {myPlayer?.phaseReady
              ? "你已结束本阶段，等待其他玩家标记后自动转场"
              : ({
                  draw: "手牌已自动补至上限，可直接结束阶段",
                  swap: `点选手牌后换牌（≤3张），剩余次数 ${swapLeft}/${myPlayer ? Math.min(3, swapLeft) : 0}`,
                  play: "点选 5 张往前打出，完成后结束阶段",
                  duel: "全员亮牌；宣告按特权证→顺时针排队",
                  settle: "奖励已发放，确认后进入购买",
                  purchase: "点中央黑市卡购买；跳过则翻面",
                  delete: "每回合免费 1 张，之后 2 筹/张",
                  reshape: "重洗牌库或拿 2 血筹，二选一后结束",
                })[snap.phase] ?? ""}
          </span>
          <span className="endInfo">
            {snap.players.filter((p) => p.phaseReady).length}/{count} 已结束
          </span>
        </div>

        <div className="consoleMain">
          <div className="piles">
            <div className="pile">
              <div className="pileStack" />
              <span>
                牌堆 <b>{myPlayer ? countOf(myPlayer.zones.draw) : 0}</b>
              </span>
            </div>
            <div className="pile">
              <div className="pileStack discard" />
              <span>
                弃牌堆 <b>{myDiscard.length}</b>
              </span>
            </div>
            <div className="pile">
              <div className="pileStack deleted" />
              <span>
                删牌区 <b>{myPlayer ? countOf(myPlayer.zones.deleted) : 0}</b>
              </span>
            </div>
            <div className="pile pileItems">
              <span className="pileLabel">道具区</span>
              <div className="items">
                {myPlayer && myPlayer.zones.items.length > 0 ? (
                  myPlayer.zones.items.map((it, i) => (
                    <span key={i} className="itemCard">
                      {it}
                    </span>
                  ))
                ) : (
                  <span className="emptyItems">（空）</span>
                )}
              </div>
            </div>
            <div className="pile">
              <span>
                芯片 <b>{myPlayer ? Object.keys(myPlayer.zones.chips).length : 0}</b>
                {myPlayer && Object.keys(myPlayer.zones.chips).length > 0
                  ? `（${Object.values(myPlayer.zones.chips).join(",")}）`
                  : ""}
              </span>
            </div>
          </div>

          <div className="handRow">
            {myHand.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`card${selected.has(c.id) ? " sel" : ""}`}
                onClick={() => toggle(c.id)}
                disabled={snap.phase !== "swap" && snap.phase !== "play"}
                aria-label={`${selected.has(c.id) ? "已选" : "未选"} ${c.rank ?? "JOKER"}${c.suit ?? ""}`}
              >
                <span className="check">{selected.has(c.id) ? "✓" : ""}</span>
                <CardFace card={c} />
              </button>
            ))}
            {myHand.length === 0 ? <span className="emptyHint">手牌为空</span> : null}
          </div>
        </div>
      </div>

      <Log log={snap.log} />

      {/* 删牌阶段：弃牌区选择弹层（样式对齐原型弹层） */}
      {deleteOpen ? (
        <CardPicker
          candidates={myDiscard.map((c) => c.id)}
          from="discard"
          cards={myDiscard}
          multiSelect
          promptText="本回合免费删 1 张；之后每删 1 张付 2 血筹"
          onConfirm={(ids) => {
            onAction({ type: "deleteCards", cardIds: ids });
            setSelected(new Set());
            setDeleteOpen(false);
          }}
          onCancel={() => setDeleteOpen(false)}
        />
      ) : null}
    </div>
  );
}
