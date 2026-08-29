import { useState } from "react";
import { ENGINE_VERSION } from "@crimson/engine";

type Mode = "easy" | "standard" | "solo";

interface ModeEntry {
  id: Mode;
  name: string;
  desc: string;
  tag: string;
  /** false = 灰显「敬请期待 M3」（grilling Q6 决策） */
  available: boolean;
}

/** 模式选择。当前无大厅/建房 UI（WS 联调在 15 号票据），此处为占位入口。 */
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

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null);

  return (
    <div className="app-root">
      <h1 className="app-title">血色牌局</h1>
      <p className="app-sub">归乡特快 · 发车准备中（engine v{ENGINE_VERSION}）</p>
      <div className="mode-select">
        {MODES.map((m) =>
          m.available ? (
            <button
              key={m.id}
              type="button"
              className="mode-card available"
              onClick={() => setMode(m.id)}
            >
              <span className="mode-name">{m.name}</span>
              <span className="mode-tag">{m.tag}</span>
              <span className="mode-desc">{m.desc}</span>
              {mode === m.id ? <span className="mode-picked">✓ 已选择</span> : null}
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
      {mode === "easy" ? (
        <p className="app-note">
          已选择「简易模式」。建房 / 大厅流程待 15 号票据（WebSocket 联调）接入后可用。
        </p>
      ) : null}
    </div>
  );
}
