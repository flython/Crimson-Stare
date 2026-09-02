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
import type { Card, CardDef, CardPool } from "@crimson/engine";
import type { TablePlayer, ViewPendingPrompt } from "../lib/types.js";
import type { SnapState } from "../lib/ws.js";
import PendingPromptBanner from "./PendingPromptBanner.js";
import CardPicker from "./CardPicker.js";
import type { CardSource } from "./CardPicker.js";
import DeclarationDialog from "./DeclarationDialog.js";

export interface TableProps {
  snap: SnapState;
  you: string;
  /** 卡池元数据（票据 19 下发，可选——未收到前按 defId 降级显示） */
  pool: CardPool | null;
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

/**
 * 数值类芯片的点数修正值（与 engine 注册表一致）。
 * 用于 UI 显示"9 (5+4)"——baseRank 由 engine addPermanentRank 写入 card.baseRank。
 */
const CHIP_DELTA: Record<string, number> = {
  "001": 1, "002": 2, "003": 3, "004": 4,
  "005": -1, "006": -2, "007": -3,
};

/**
 * 花色声明类芯片覆盖的花色（显示"♠(原♥)"）。
 * null = 任意花色（变色墨水）；S/C = 黑色芯片；H/D = 红色芯片。
 */
const CHIP_SUIT_MAP: Record<string, string[] | null> = {
  "008": null, // 变色墨水：任意花色
  "009": ["S", "C"], // 黑色芯片：♠♣
  "010": ["H", "D"], // 红色芯片：♦♥
};

/** 声明类芯片（出牌时需弹出声明面板，票据 22） */
const DECLARE_TYPE_CHIPS = new Set(["008", "009", "010", "011", "012"]);

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

/**
 * 占位卡面：纯色块 + 点数/花色（图片缺失回退，与 05 原型一致）。
 * 芯片可视化（票据 21）：
 * - 角标：金色芯片徽章（有 chipDefId）
 * - 详情：title tooltip = 芯片名称 + 效果文本
 * - 数值芯片：显示修改后点数，括号内「原始点数±加值」
 * - 花色芯片：显示声明花色，括号内「原花色」
 */
function CardFace({
  card,
  chipDefId,
  marketById,
}: {
  card: Card;
  chipDefId?: string;
  marketById?: Map<string, CardDef>;
}) {
  const chipDef = chipDefId && marketById ? marketById.get(chipDefId) : undefined;
  const delta = chipDefId ? CHIP_DELTA[chipDefId] : undefined;
  const suitOverride = chipDefId ? CHIP_SUIT_MAP[chipDefId] : undefined;

  // Joker
  if (card.isJoker || card.suit === null || card.rank === null) {
    return (
      <>
        {chipDefId && <span className="chipIcon" title={chipDef ? `${chipDef.name}：${chipDef.effectText}` : chipDefId} />}
        <span className="joker-text">JOKER</span>
      </>
    );
  }

  const red = card.suit === "H" || card.suit === "D";
  const baseRank = card.baseRank ?? card.rank;
  const hasValueChip = delta !== undefined;

  // 花色覆盖显示
  let suitEl = <span className={`suit${red ? " red" : ""}`}>{SUIT_SYMBOL[card.suit]}</span>;
  if (suitOverride !== undefined) {
    // 显示声明花色，括号内原花色
    const declared = suitOverride ?? ["♠", "♥", "♦", "♣"];
    const declaredStr = declared.length === 4 ? "任意" : declared.map((s) => SUIT_SYMBOL[s] ?? s).join("");
    suitEl = (
      <span className={`suit${red ? " red" : ""}`} title={`原${SUIT_SYMBOL[card.suit]}`}>
        {declaredStr}({SUIT_SYMBOL[card.suit]})
      </span>
    );
  }

  // 点数显示：数值芯片显示"修改后(基础±delta)"
  let rankEl = <span className={`rank${red ? " red" : ""}`}>{card.rank}</span>;
  if (hasValueChip && baseRank !== card.rank) {
    const sign = delta! > 0 ? "+" : "";
    rankEl = (
      <span className={`rank${red ? " red" : ""}`} title={`基础${baseRank}，芯片${sign}${delta}`}>
        {card.rank}({baseRank}{sign === "+" ? "+" : ""}{delta})
      </span>
    );
  } else if (hasValueChip && baseRank === card.rank) {
    // 芯片已插入但还没结算（少见），只显示芯片图标
  }

  return (
    <>
      {chipDefId && <span className="chipIcon" title={chipDef ? `${chipDef.name}：${chipDef.effectText}` : chipDefId} />}
      {suitEl}
      {rankEl}
    </>
  );
}

/** 座位信息条：角色卡（卡名+技能 tooltip 来自卡池元数据）+ 名字/徽章 + 票筹换牌牌库统计 + 手牌 */
function SeatInfo({
  p,
  goal,
  isPass,
  active,
  isMe,
  role,
}: {
  p: SnapPlayer;
  goal: number;
  isPass: boolean;
  active: boolean;
  isMe: boolean;
  role: CardDef | undefined;
}) {
  const handCount = countOf(p.zones.hand);
  const backs = Math.min(handCount, MAX_HAND_BACKS);
  return (
    <div className={`seatInfo${active ? " active" : ""}`}>
      <div
        className="charCard"
        title={role ? `${role.name}·${role.title ?? ""}：${role.effectText}` : "角色元数据加载中"}
      >
        {role ? <CardImg image={role.image} /> : null}
        {role?.name ?? p.characterId?.slice(-3) ?? p.name.slice(0, 1)}
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
function PlayZone({
  dir,
  p,
  chips,
  marketById,
}: {
  dir: SeatDir | "me";
  p?: SnapPlayer;
  chips: Record<string, string>;
  marketById: Map<string, CardDef>;
}) {
  const rot = dir === "left" ? "rot90" : dir === "right" ? "rot-90" : dir === "top" ? "rot180" : "";
  const zone = p?.zones.play;
  const cards = zone ? cardsOf(zone) : [];
  // 暗扣（票据 24）：出牌阶段他人出牌只见牌背（count 摘要），对决亮牌后为 cards
  const concealed = zone && "count" in zone ? zone.count : 0;
  const who = p ? p.name : "";
  return (
    <div className="playZone">
      <span className="pwho">{who || (dir === "me" ? "你" : "")}</span>
      {cards.length === 0 ? (
        concealed > 0 ? (
          <span className="playBacks">
            {Array.from({ length: Math.min(concealed, 5) }, (_, i) => (
              <span key={i} className={`card small back${rot}`} />
            ))}
          </span>
        ) : (
          <span className="emptyHint">{dir === "me" ? "出牌区" : "等待出牌…"}</span>
        )
      ) : (
        cards.map((c) => (
          <span key={c.id} className={rot}>
            <span className="card small">
              <CardFace card={c} chipDefId={chips[c.id]} marketById={marketById} />
            </span>
          </span>
        ))
      )}
    </div>
  );
}

/** 卡牌图片 URL（票据 18）：元数据 assets/cards/<类>/<ID>.png → public 的 /cards/<类>/<ID>.png */
function cardImgUrl(image: string): string {
  return "/" + image.replace(/^assets\//, "");
}

/** 卡面图片：加载失败自动隐藏（onError），露出下层文字占位——零状态回退 */
function CardImg({ image }: { image: string }) {
  return (
    <img
      className="cardImg"
      src={cardImgUrl(image)}
      alt=""
      loading="lazy"
      draggable={false}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}

/** 黑市卡分类色：优先用元数据 colorTag（牌型绿/容错蓝/互动暗红），缺省回退 subtype 映射 */
function marketCat(subtype: string | undefined, colorTag?: string): string {
  if (colorTag === "牌型绿") return "cat-green";
  if (colorTag === "容错蓝") return "cat-blue";
  if (colorTag === "互动暗红") return "cat-red";
  return subtypeCat(subtype);
}

/** 黑市卡：卡名/效果文本来自卡池元数据（19），元数据未到时回退 defId */
function MarketCard({
  slot,
  phase,
  meta,
  onBuy,
}: {
  slot: SnapState["blackMarket"]["slots"][number];
  phase: string;
  meta: CardDef | undefined;
  onBuy: () => void;
}) {
  if (!slot.defId) return <div className="bm-card empty" />;
  const purchasable = phase === "purchase";
  return (
    <button
      type="button"
      className={`bm-card ${marketCat(slot.subtype, meta?.colorTag)}${purchasable ? " buyable" : ""}`}
      disabled={!purchasable}
      onClick={onBuy}
      title={meta?.effectText ?? ""}
    >
      {slot.bonusChips > 0 ? <span className="bonus">{slot.bonusChips}</span> : null}
      {meta ? <CardImg image={meta.image} /> : null}
      <span className="bmName">{meta?.name ?? slot.defId}</span>
      <span className="bmSub">{meta?.effectText ?? slot.subtype ?? ""}</span>
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

export default function Table({ snap, you, pool, onAction, onResolve }: TableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 删牌阶段：弃牌区选择弹层（复用 14 号 CardPicker，从弃牌区选牌删除） */
  const [deleteOpen, setDeleteOpen] = useState(false);
  /** 暗扣声明弹层（22）：要出的牌中含声明类芯片时弹出 */
  const [declOpen, setDeclOpen] = useState(false);
  /** declOpen=true 时，暂存即将提交出牌的 cardIds */
  const [pendingPlayIds, setPendingPlayIds] = useState<string[]>([]);
  /** 弃牌区/删牌区/道具区查看弹层（30）：null = 未打开 */
  const [viewZone, setViewZone] = useState<"discard" | "deleted" | "items" | null>(null);

  /** 卡池元数据查找表（19）：角色/黑市 id → CardDef */
  const roleById = new Map((pool?.roles ?? []).map((r) => [r.id, r]));
  const marketById = new Map((pool?.market ?? []).map((m) => [m.id, m]));

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

    // 暗扣声明拦截（票据 22）：出牌含声明类芯片时弹出声明面板
    if (type === "playCards") {
      const chips = myPlayer?.zones.chips ?? {};
      const declCards = zoneCards
        .filter((c) => {
          const defId = chips[c.id];
          return ids.includes(c.id) && defId && DECLARE_TYPE_CHIPS.has(defId);
        })
        .map((c) => {
          const chipDefId = chips[c.id]!;
          return {
            card: c,
            chipDefId,
            chipDef: marketById.get(chipDefId)!,
          };
        })
        .filter((x) => x.chipDef); // 过滤掉找不到元数据的
      if (declCards.length > 0) {
        setPendingPlayIds(ids);
        setDeclOpen(true);
        return;
      }
    }

    onAction({ type, ...(type === "swap" ? { discardIds: ids } : { cardIds: ids }) });
    setSelected(new Set());
  }

  /** 声明确认后正式提交 playCards（含 declarations） */
  function confirmPlayWithDecl(declarations: Record<string, string>) {
    onAction({ type: "playCards", cardIds: pendingPlayIds, declarations });
    setSelected(new Set());
    setDeclOpen(false);
    setPendingPlayIds([]);
  }

  const swapLeft = myPlayer?.swapLeft ?? 0;

  // 交互挂起：目标玩家见完整候选（本人视角），他人见 waitingFor
  const prompt = (snap.pendingPrompt as ViewPendingPrompt | null) ?? null;
  const cardsByZone: Partial<Record<CardSource, Card[]>> = {
    hand: myHand,
    discard: myDiscard,
    play: myPlayer ? cardsOf(myPlayer.zones.play) : [],
    deleted: myPlayer ? cardsOf(myPlayer.zones.deleted) : [],
    deck: [...(myPlayer ? cardsOf(myPlayer.zones.draw) : []), ...myDiscard], // 全牌库（清洁工）
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
                <SeatInfo p={seats.top} goal={goal} isPass={snap.passHolderSeat === seats.top.seat} active={!seats.top.phaseReady} isMe={false} role={seats.top.characterId ? roleById.get(seats.top.characterId) : undefined} />
                <PlayZone dir="top" p={seats.top} chips={seats.top?.zones.chips ?? {}} marketById={marketById} />
              </>
            ) : (
              <div className="seatInfo empty-seat">空位</div>
            )}
          </div>

          <div className="seat seatLeft">
            {seats.left ? (
              <>
                <PlayZone dir="left" p={seats.left} chips={seats.left?.zones.chips ?? {}} marketById={marketById} />
                <SeatInfo p={seats.left} goal={goal} isPass={snap.passHolderSeat === seats.left.seat} active={!seats.left.phaseReady} isMe={false} role={seats.left.characterId ? roleById.get(seats.left.characterId) : undefined} />
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
                <MarketCard
                  key={i}
                  slot={slot}
                  phase={snap.phase}
                  meta={slot.defId ? marketById.get(slot.defId) : undefined}
                  onBuy={() => onAction({ type: "purchase", slotIndex: i })}
                />
              ))}
            </div>
            <div className="zoneTitle">购买阶段结束时最右两格叠加 1 血筹</div>
          </div>

          <div className="seat seatRight">
            {seats.right ? (
              <>
                <PlayZone dir="right" p={seats.right} chips={seats.right?.zones.chips ?? {}} marketById={marketById} />
                <SeatInfo p={seats.right} goal={goal} isPass={snap.passHolderSeat === seats.right.seat} active={!seats.right.phaseReady} isMe={false} role={seats.right.characterId ? roleById.get(seats.right.characterId) : undefined} />
              </>
            ) : (
              <div className="seatInfo empty-seat">空位</div>
            )}
          </div>

          <div className="seat seatMe">
            <PlayZone dir="me" p={myPlayer} chips={myPlayer?.zones.chips ?? {}} marketById={marketById} />
            {myPlayer ? (
              <SeatInfo p={myPlayer} goal={goal} isPass={snap.passHolderSeat === myPlayer.seat} active={!myPlayer.phaseReady} isMe role={myPlayer.characterId ? roleById.get(myPlayer.characterId) : undefined} />
            ) : null}
          </div>
        </div>
      </div>

      {/* 我的操作台 */}
      <div className="console">
        <div className="consoleBar">
          <span className="name">
            你 · {myPlayer?.characterId ? (roleById.get(myPlayer.characterId)?.name ?? myPlayer.characterId) : "?"}
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
                {myDiscard.length > 0 && (
                  <button type="button" className="viewBtn" onClick={() => setViewZone("discard")}>
                    查看
                  </button>
                )}
              </span>
            </div>
            <div className="pile">
              <div className="pileStack deleted" />
              <span>
                删牌区 <b>{myPlayer ? countOf(myPlayer.zones.deleted) : 0}</b>
                {(myPlayer ? countOf(myPlayer.zones.deleted) : 0) > 0 && (
                  <button type="button" className="viewBtn" onClick={() => setViewZone("deleted")}>
                    查看
                  </button>
                )}
              </span>
            </div>
            <div className="pile pileItems">
              <span className="pileLabel">道具区</span>
              <div className="items">
                {myPlayer && myPlayer.zones.items.length > 0 ? (
                  <>
                    {myPlayer.zones.items.map((it, i) => (
                      <span key={i} className="itemCard" title={marketById.get(it)?.effectText ?? ""}>
                        {marketById.get(it)?.name ?? it}
                      </span>
                    ))}
                    <button type="button" className="viewBtn" onClick={() => setViewZone("items")}>
                      查看
                    </button>
                  </>
                ) : (
                  <span className="emptyItems">（空）</span>
                )}
              </div>
            </div>
            <div className="pile">
              <span>
                芯片 <b>{myPlayer ? Object.keys(myPlayer.zones.chips).length : 0}</b>
                {myPlayer && Object.keys(myPlayer.zones.chips).length > 0
                  ? `（${Object.values(myPlayer.zones.chips)
                      .map((d) => marketById.get(d)?.name ?? d)
                      .join(",")}）`
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
                <CardFace card={c} chipDefId={myPlayer?.zones.chips[c.id]} marketById={marketById} />
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

      {/* 暗扣声明弹层（票据 22）：出牌含声明类芯片时弹出 */}
      {declOpen ? (
        <DeclarationDialog
          cards={myHand
            .filter((c) => pendingPlayIds.includes(c.id))
            .map((c) => {
              const chipDefId = myPlayer?.zones.chips[c.id] ?? "";
              return { card: c, chipDefId, chipDef: marketById.get(chipDefId)! };
            })
            .filter((x) => x.chipDef && DECLARE_TYPE_CHIPS.has(x.chipDefId))}
          onConfirm={confirmPlayWithDecl}
          onCancel={() => { setDeclOpen(false); setPendingPlayIds([]); }}
        />
      ) : null}

      {/* 弃牌区/删牌区/道具区查看弹层（票据 30）：自己可随时查看 */}
      {viewZone ? (
        <div className="overlay" onClick={() => setViewZone(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{viewZone === "discard" ? "弃牌区" : viewZone === "deleted" ? "删牌区" : "道具区"}</h3>
            <div className="picker-grid">
              {viewZone === "items"
                ? (myPlayer?.zones.items ?? []).map((it, i) => {
                    const meta = marketById.get(it);
                    return (
                      <span key={i} className="card joker" title={meta?.effectText ?? ""}>
                        {meta?.name ?? it}
                      </span>
                    );
                  })
                : (viewZone === "discard" ? myDiscard : myPlayer ? cardsOf(myPlayer.zones.deleted) : []).map((c) => (
                    <span key={c.id} className="card joker">
                      <CardFace card={c} />
                    </span>
                  ))}
            </div>
            <div className="picker-actions">
              <button type="button" className="btn gold" onClick={() => setViewZone(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
