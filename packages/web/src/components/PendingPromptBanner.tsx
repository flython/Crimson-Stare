import type { Card, CardDef } from "@crimson/engine";
import type { TablePlayer, ViewPendingPrompt } from "../lib/types.js";
import { pendingPromptForMe, pendingPromptWaiter } from "../lib/types.js";
import TargetPicker from "./TargetPicker.js";
import CardPicker from "./CardPicker.js";
import type { CardSource } from "./CardPicker.js";

export interface PendingPromptBannerProps {
  /** stateUpdate.pendingPrompt（裁剪后形状；null = 无挂起） */
  prompt: ViewPendingPrompt | null;
  /** 我的玩家 id */
  myPlayerId: string;
  /** 牌桌玩家（名字查询 + TargetPicker 数据源） */
  players: TablePlayer[];
  /** 我方各区域牌（chooseCard 渲染数据源：from → cards；"deck" = 抽牌堆+弃牌区） */
  cardsByZone?: Partial<Record<CardSource, Card[]>>;
  /** 黑市卡池元数据（043 再来一批渲染 market 栏位用） */
  marketById?: Map<string, CardDef>;
  /** 确认选择 → 发送 resolvePrompt */
  onResolve: (choice: string | string[]) => void;
  /** 取消交互 */
  onCancel?: () => void;
}

/**
 * PendingPromptBanner — 顶部横幅，接 stateUpdate.pendingPrompt，三态：
 * ① 等待我选择：血红强调横幅 + 激活对应 Picker（choosePlayer → TargetPicker / chooseCard → CardPicker）；
 * ② 等待其他玩家：显示「等待 X 选择…」（附公开 promptText）；
 * ③ 无挂起：返回 null 不渲染。
 */
export default function PendingPromptBanner({
  prompt,
  myPlayerId,
  players,
  cardsByZone = {},
  marketById,
  onResolve,
  onCancel,
}: PendingPromptBannerProps) {
  if (!prompt) return null;

  const waiterId = pendingPromptWaiter(prompt);
  const waiterName = players.find((p) => p.id === waiterId)?.name ?? waiterId;

  // ② 等待其他玩家（或裁剪态下看不到候选）
  if (!pendingPromptForMe(prompt, myPlayerId)) {
    return (
      <div className="prompt-banner">
        <span className="prompt-kind">待交互</span>
        <span className="prompt-text">等待 {waiterName} 选择…</span>
        {prompt.promptText ? <span className="prompt-sub">{prompt.promptText}</span> : null}
      </div>
    );
  }

  // ① 等待我：激活对应 Picker
  return (
    <>
      <div className="prompt-banner mine">
        <span className="prompt-kind">轮到你</span>
        <span className="prompt-text">{prompt.promptText ?? "请完成选择"}</span>
      </div>
      {prompt.kind === "choosePlayer" ? (
        <TargetPicker
          candidates={prompt.candidates}
          players={players}
          promptText={prompt.promptText}
          onConfirm={onResolve}
          onCancel={onCancel}
        />
      ) : prompt.kind === "chooseOption" ? (
        <div className="option-picker">
          <div className="option-picker-row">
            {prompt.options.map((o) => (
              <button key={o.id} className="btn" onClick={() => onResolve(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
          {onCancel ? (
            <button className="btn ghost" onClick={onCancel}>
              取消
            </button>
          ) : null}
        </div>
      ) : (
        <CardPicker
          candidates={prompt.candidates}
          from={prompt.from}
          cards={cardsByZone[prompt.from] ?? []}
          allowEmpty
          promptText={prompt.promptText}
          onConfirm={onResolve}
          onCancel={onCancel}
          marketById={marketById}
        />
      )}
    </>
  );
}
